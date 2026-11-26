// The PDF upload flow end to end: sign-url API → the file PUT straight to
// Storage (a local stand-in speaking Supabase's storage HTTP API, driven by
// the real supabase-js client) → complete → background render → a clean
// page for the flipbook and the watermarked Print + Digital PDF for a buyer.
//
// CI runs it on the small fake sample. To run it on a real PDF locally
// (never committed, never required in CI):
//
//   STORE_LOCAL_PDF=/path/to/review.pdf NODE_OPTIONS=--experimental-require-module \
//     npx vitest run src/lib/store/__tests__/upload-flow.test.ts
//
// Outputs (timings, page images, the buyer's PDF) go to tmp/store-local-pdf/.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, storeRpcs, type MemoryDb } from "../testing/memory-db";
import { catalogue, IDS } from "../testing/fixtures";
import { startLocalStorage, type LocalStorage } from "../testing/local-storage";
import { checkStoredObject, isAudioPathFor, MAX_AUDIO_BYTES, MAX_PDF_BYTES, SIGNED_UPLOAD_TTL_SECONDS, validateAudioUpload, validatePdfUpload } from "../upload";
import { hashDeviceId } from "../devices";

vi.mock("server-only", () => ({}));

let db: MemoryDb;
let storage: LocalStorage;
let sb: ReturnType<typeof createSupabase>;
let who: { id: string; email: string; email_confirmed_at?: string | null } | null = null;
let grants: string[] = [];
const background: Promise<unknown>[] = [];

vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => Promise<unknown>) => void background.push(fn()) };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: db.client.from,
    rpc: async (name: string, args: Record<string, unknown>) =>
      name === "has_permission" ? { data: !!who && grants.includes(String(args.required_permission)), error: null } : db.client.rpc(name, args),
    auth: { getUser: async () => ({ data: { user: who }, error: null }) },
  }),
}));
vi.mock("@/lib/store/db", () => ({ storeAdminClient: () => ({ ...db.client, storage: sb.storage }) }));

const STAFF = { id: "staff-1", email: "media@example.org" };
const BUYER = { id: "buyer-1", email: "reader@example.org", email_confirmed_at: "2026-01-01T00:00:00Z" };
const SAMPLE = path.join(__dirname, "../fixtures/sample-review.pdf");
const LOCAL_PDF = process.env.STORE_LOCAL_PDF?.trim();

const post = (url: string, body?: unknown) =>
  new Request(`https://hub.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seed() {
  db = createMemoryDb(
    {
      users: [{ id: STAFF.id, is_active: true }],
      user_roles: [{ user_id: STAFF.id, roles: { name: "staff" } }],
      store_products: catalogue.products,
      store_variants: catalogue.variants,
      store_entitlements: [
        { id: "ent-1", product_id: IDS.bundle, email: BUYER.email, user_id: BUYER.id, source: "purchase", order_item_id: null, code_id: null, includes_pdf: true, starts_at: "2026-01-01T00:00:00Z", expires_at: null, revoked_at: null },
      ],
    },
    { rpc: storeRpcs }
  );
}

beforeAll(async () => {
  storage = await startLocalStorage(path.join(os.tmpdir(), `store-upload-${process.pid}`), { "store-source": MAX_PDF_BYTES, "store-audio": MAX_AUDIO_BYTES });
  sb = createSupabase(storage.url, "local-test-key", { auth: { persistSession: false } });
});
afterAll(async () => {
  await storage.close();
  rmSync(storage.root, { recursive: true, force: true });
});
beforeEach(() => {
  seed();
  who = STAFF;
  grants = ["store.manage"];
  background.length = 0;
  vi.stubEnv("STORE_SIGNING_SECRET", "local-test-secret-0123456789");
});

/** Staff uploads `pdf` for the Print + Digital product the way the admin page does. */
async function uploadAndRender(pdf: Blob, filename: string) {
  const sign = await import("@/app/api/store/admin/products/[id]/pdf/route");
  const complete = await import("@/app/api/store/admin/assets/[id]/complete/route");
  const status = await import("@/app/api/store/admin/assets/[id]/route");
  const t0 = Date.now();

  const res = await sign.POST(post(`/api/store/admin/products/${IDS.bundle}/pdf`, { filename, contentType: "application/pdf", size: pdf.size }), ctx(IDS.bundle));
  expect(res.status).toBe(200);
  const s = await res.json();
  expect(s).toMatchObject({ bucket: "store-source", maxBytes: MAX_PDF_BYTES });
  expect(s.path).toBe(`${IDS.bundle}/${s.assetId}.pdf`); // our path, not the file name
  expect(db.table("store_assets")[0]).toMatchObject({ status: "awaiting_upload", byte_size: pdf.size, filename });

  // The browser's PUT, straight to Storage with the signed token.
  const up = await sb.storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, pdf, { contentType: "application/pdf" });
  expect(up.error).toBeNull();
  const uploadMs = Date.now() - t0;

  const done = await complete.POST(post(`/api/store/admin/assets/${s.assetId}/complete`), ctx(s.assetId));
  expect(done.status).toBe(202);
  // A double-click doesn't start a second render.
  expect((await complete.POST(post(`/api/store/admin/assets/${s.assetId}/complete`), ctx(s.assetId))).status).toBe(409);
  const mid = await (await status.GET(new Request("https://hub.test/x"), ctx(s.assetId))).json();
  expect(mid.status).toBe("rendering");

  await Promise.all(background);
  const renderMs = Date.now() - t0 - uploadMs;
  const final = await (await status.GET(new Request("https://hub.test/x"), ctx(s.assetId))).json();
  return { assetId: s.assetId as string, final, uploadMs, renderMs };
}

async function buyerPage(assetId: string, page: number) {
  const { pageUrl } = await import("../signing");
  const { GET } = await import("@/app/api/store/page/route");
  const res = await GET(new Request(`https://hub.test${pageUrl({ assetId, page, viewer: BUYER.email })}`));
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

async function buyerPdf() {
  const { GET } = await import("@/app/api/store/library/[productId]/pdf/route");
  const res = await GET(new Request("https://hub.test/x"), { params: Promise.resolve({ productId: IDS.bundle }) });
  expect(res.status).toBe(303);
  const signed = res.headers.get("location")!;
  expect(signed.startsWith(storage.url)).toBe(true);
  const r = await fetch(signed);
  expect(r.ok).toBe(true);
  return Buffer.from(await r.arrayBuffer());
}

describe("upload rules", () => {
  it("accepts a 21.9 MB PDF and refuses anything over 50 MB, or not a PDF", () => {
    expect(validatePdfUpload({ filename: "draft.pdf", contentType: "application/pdf", size: 22_972_092 }).ok).toBe(true);
    expect(validatePdfUpload({ filename: "draft.pdf", contentType: "application/pdf", size: MAX_PDF_BYTES }).ok).toBe(true);
    expect(validatePdfUpload({ filename: "draft.pdf", contentType: "application/pdf", size: MAX_PDF_BYTES + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(validatePdfUpload({ filename: "draft.docx", contentType: "application/pdf", size: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(validatePdfUpload({ filename: "draft.pdf", contentType: "image/png", size: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(validatePdfUpload({ filename: "draft.pdf", contentType: "application/pdf", size: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(validatePdfUpload(null)).toMatchObject({ ok: false });
  });

  it("checks the stored object against what was signed for", () => {
    expect(checkStoredObject({ size: 100 }, 100)).toEqual({ ok: true });
    expect(checkStoredObject(null, 100).ok).toBe(false);
    expect(checkStoredObject({ size: 99 }, 100).ok).toBe(false);
    expect(checkStoredObject({ size: MAX_PDF_BYTES + 1 }, null).ok).toBe(false);
  });

  it("the sign-url API takes metadata only: 413 over 50 MB, 403 without store.manage, 401 signed out", async () => {
    const { POST } = await import("@/app/api/store/admin/products/[id]/pdf/route");
    const meta = { filename: "big.pdf", contentType: "application/pdf", size: MAX_PDF_BYTES + 1 };
    expect((await POST(post(`/x`, meta), ctx(IDS.bundle))).status).toBe(413);
    grants = ["store.view"];
    expect((await POST(post(`/x`, { ...meta, size: 1000 }), ctx(IDS.bundle))).status).toBe(403);
    who = BUYER;
    grants = [];
    expect((await POST(post(`/x`, { ...meta, size: 1000 }), ctx(IDS.bundle))).status).toBe(403);
    who = null;
    expect((await POST(post(`/x`, { ...meta, size: 1000 }), ctx(IDS.bundle))).status).toBe(401);
    expect(db.table("store_assets")).toHaveLength(0);
  });

  it("Storage itself refuses a PUT over the bucket's 50 MB limit", async () => {
    const { data } = await sb.storage.from("store-source").createSignedUploadUrl("x/too-big.pdf");
    const { error } = await sb.storage.from("store-source").uploadToSignedUrl("x/too-big.pdf", data!.token, Buffer.alloc(MAX_PDF_BYTES + 1), { contentType: "application/pdf" });
    expect(error).not.toBeNull();
  });

  it("complete fails the upload when the stored file doesn't match the size signed for", async () => {
    const sign = await import("@/app/api/store/admin/products/[id]/pdf/route");
    const complete = await import("@/app/api/store/admin/assets/[id]/complete/route");
    const pdf = readFileSync(SAMPLE);
    const s = await (await sign.POST(post(`/x`, { filename: "s.pdf", contentType: "application/pdf", size: pdf.length + 5 }), ctx(IDS.bundle))).json();
    await sb.storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, new Blob([pdf], { type: "application/pdf" }));
    const res = await complete.POST(post(`/x`), ctx(s.assetId));
    expect(res.status).toBe(400);
    expect(db.table("store_assets")[0]).toMatchObject({ status: "failed" });
  });

  it("complete before the upload finished says so", async () => {
    const sign = await import("@/app/api/store/admin/products/[id]/pdf/route");
    const complete = await import("@/app/api/store/admin/assets/[id]/complete/route");
    const s = await (await sign.POST(post(`/x`, { filename: "s.pdf", contentType: "application/pdf", size: 100 }), ctx(IDS.bundle))).json();
    const res = await complete.POST(post(`/x`), ctx(s.assetId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/didn't finish uploading/);
  });

  it("signs with an explicit window, and complete refuses an upload signed longer ago than that", async () => {
    const sign = await import("@/app/api/store/admin/products/[id]/pdf/route");
    const complete = await import("@/app/api/store/admin/assets/[id]/complete/route");
    const s = await (await sign.POST(post(`/x`, { filename: "s.pdf", contentType: "application/pdf", size: 100 }), ctx(IDS.bundle))).json();
    expect(s.expiresIn).toBe(SIGNED_UPLOAD_TTL_SECONDS);
    expect(Date.parse(s.expiresAt) - Date.now()).toBeGreaterThan((SIGNED_UPLOAD_TTL_SECONDS - 60) * 1000);
    // The upload lands, but only after the window closed.
    await sb.storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, new Blob([new Uint8Array(100)], { type: "application/pdf" }));
    db.table("store_assets")[0].created_at = new Date(Date.now() - (SIGNED_UPLOAD_TTL_SECONDS + 1) * 1000).toISOString();
    const res = await complete.POST(post(`/x`), ctx(s.assetId));
    expect(res.status).toBe(410);
    expect(db.table("store_assets")[0]).toMatchObject({ status: "failed" });
    expect(db.table("store_assets")[0].is_active).not.toBe(true);
    expect(background).toHaveLength(0);
  });
});

describe("background music", () => {
  const DEVICE = "reader-device-0123456789";
  const withDevice = (url: string) => new Request(`https://hub.test${url}`, { headers: { "x-store-device": DEVICE } });
  const pctx = (productId: string) => ({ params: Promise.resolve({ productId }) });
  const put = (url: string, body: unknown) =>
    new Request(`https://hub.test${url}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("takes audio files only, up to 20 MB", () => {
    expect(validateAudioUpload({ filename: "song.mp3", contentType: "audio/mpeg", size: 5_000_000 })).toMatchObject({ ok: true, value: { ext: "mp3" } });
    expect(validateAudioUpload({ filename: "song.m4a", contentType: "audio/x-m4a", size: 5_000_000 })).toMatchObject({ ok: true, value: { ext: "m4a" } });
    expect(validateAudioUpload({ filename: "x.pdf", contentType: "application/pdf", size: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(validateAudioUpload({ filename: "big.wav", contentType: "audio/wav", size: MAX_AUDIO_BYTES + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(isAudioPathFor(IDS.bundle, `${IDS.bundle}/aaaaaaaa-0000-4000-8000-000000000001.mp3`)).toBe(true);
    expect(isAudioPathFor(IDS.bundle, `${IDS.review}/aaaaaaaa-0000-4000-8000-000000000001.mp3`)).toBe(false);
    expect(isAudioPathFor(IDS.bundle, `${IDS.bundle}/../x.mp3`)).toBe(false);
  });

  it("uploads straight to the private bucket and serves an entitled reader a signed link; nobody else", async () => {
    const route = await import("@/app/api/store/admin/products/[id]/audio/route");
    const library = await import("@/app/api/store/library/[productId]/audio/route");
    const song = new Blob([Buffer.alloc(4096, 7)], { type: "audio/mpeg" });

    // Staff: sign, PUT to Storage, confirm.
    const res = await route.POST(post(`/api/store/admin/products/${IDS.bundle}/audio`, { filename: "Worship.mp3", contentType: "audio/mpeg", size: song.size }), ctx(IDS.bundle));
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.bucket).toBe("store-audio");
    expect(isAudioPathFor(IDS.bundle, s.path)).toBe(true); // our path, not the file name
    expect((await sb.storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, song, { contentType: "audio/mpeg" })).error).toBeNull();
    // A path for another product is refused.
    expect((await route.PUT(put("/x", { path: s.path }), ctx(IDS.review))).status).toBe(400);
    expect((await route.PUT(put("/x", { path: s.path }), ctx(IDS.bundle))).status).toBe(200);
    expect(db.table("store_products").find((p) => p.id === IDS.bundle)?.audio_path).toBe(s.path);

    // Merch has no flipbook, so no music.
    expect((await route.POST(post("/x", { filename: "a.mp3", contentType: "audio/mpeg", size: 10 }), ctx(IDS.tee))).status).toBe(400);
    // Not staff.
    grants = [];
    who = BUYER;
    expect((await route.POST(post("/x", { filename: "a.mp3", contentType: "audio/mpeg", size: 10 }), ctx(IDS.bundle))).status).toBe(403);

    // Reader: needs a registered device…
    expect((await library.GET(withDevice("/x"), pctx(IDS.bundle))).status).toBe(403);
    db.table("store_devices").push({ id: "dev-1", user_id: BUYER.id, device_hash: hashDeviceId(DEVICE), removed_at: null });
    const ok = await library.GET(withDevice("/x"), pctx(IDS.bundle));
    expect(ok.status).toBe(200);
    const { url } = await ok.json();
    expect(url.startsWith(storage.url)).toBe(true);
    expect((await (await fetch(url)).arrayBuffer()).byteLength).toBe(4096);
    // …and the product in their library.
    expect((await library.GET(withDevice("/x"), pctx(IDS.review))).status).toBe(403);
    // Signed out.
    who = null;
    expect((await library.GET(withDevice("/x"), pctx(IDS.bundle))).status).toBe(401);
  });

  it("no music uploaded: the reader gets url null", async () => {
    const library = await import("@/app/api/store/library/[productId]/audio/route");
    who = BUYER;
    db.table("store_devices").push({ id: "dev-1", user_id: BUYER.id, device_hash: hashDeviceId(DEVICE), removed_at: null });
    const res = await library.GET(withDevice("/x"), pctx(IDS.bundle));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
  });
});

describe("signed upload → render → watermark, on the small sample", () => {
  it("renders, activates, serves the buyer a clean page and builds their watermarked low-res PDF", { timeout: 120_000 }, async () => {
    const pdf = new Blob([readFileSync(SAMPLE)], { type: "application/pdf" });
    const { assetId, final } = await uploadAndRender(pdf, "sample-review.pdf");
    expect(final).toMatchObject({ status: "ready", pages: 4, error: null });
    expect(db.table("store_assets")[0]).toMatchObject({ is_active: true });
    expect(db.table("store_asset_pages").filter((p) => p.is_preview).map((p) => p.page_no)).toEqual([1, 2, 3]);

    // On-site pages carry no watermark: the route serves the stored WebP byte for byte.
    const served = await buyerPage(assetId, 1);
    expect((await sharp(served).metadata()).format).toBe("webp");
    const stored = db.table("store_asset_pages").find((p) => p.page_no === 1) as { path: string };
    expect(served.equals(readFileSync(storage.file("store-pages", stored.path)))).toBe(true);

    who = BUYER;
    grants = [];
    const bytes = await buyerPdf();
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getSubject()).toBe(`Licensed to ${BUYER.email}`);
  });
});

describe.skipIf(!LOCAL_PDF)("signed upload → render → watermark, on a real local PDF (STORE_LOCAL_PDF)", () => {
  it("handles the real file", { timeout: 1_800_000 }, async () => {
    const out = path.resolve("tmp/store-local-pdf");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const bytes = readFileSync(LOCAL_PDF!);
    const pdf = new Blob([bytes], { type: "application/pdf" });

    const rss0 = process.memoryUsage().rss;
    let peak = rss0;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
    const { assetId, final, uploadMs, renderMs } = await uploadAndRender(pdf, path.basename(LOCAL_PDF!));
    clearInterval(timer);
    expect(final.status).toBe("ready");
    expect(final.pages).toBeGreaterThan(0);

    const pages = db.table("store_asset_pages") as Array<{ page_no: number; path: string; width: number; height: number }>;
    let pageBytes = 0;
    for (const p of pages) pageBytes += statSync(storage.file("store-pages", p.path)).size;

    const t1 = Date.now();
    for (const n of [1, 2, Math.min(3, pages.length)]) writeFileSync(path.join(out, `served-p${n}.webp`), await buyerPage(assetId, n));
    const wmMs = (Date.now() - t1) / 3;

    who = BUYER;
    grants = [];
    const t2 = Date.now();
    const buyerPdfBytes = await buyerPdf();
    const pdfMs = Date.now() - t2;
    writeFileSync(path.join(out, "buyer-low-res-watermarked.pdf"), buyerPdfBytes);
    const doc = await PDFDocument.load(buyerPdfBytes);
    expect(doc.getPageCount()).toBe(final.pages);

    const shapes: Record<string, number[]> = {};
    for (const p of pages) (shapes[`${p.width}x${p.height}`] ??= []).push(p.page_no);
    const report = {
      file: path.basename(LOCAL_PDF!),
      sourceBytes: bytes.length,
      pages: final.pages,
      pageShapes: shapes,
      signedUploadMs: uploadMs,
      renderMs,
      renderedPagesBytes: pageBytes,
      servePerPageMs: Math.round(wmMs),
      buyerPdfMs: pdfMs,
      buyerPdfBytes: buyerPdfBytes.length,
      peakRssMB: Math.round(peak / 1e6),
      startRssMB: Math.round(rss0 / 1e6),
    };
    writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    // Keep the rendered (clean) pages next to the report for the screenshot run.
    mkdirSync(path.join(out, "pages"), { recursive: true });
    for (const p of pages) writeFileSync(path.join(out, "pages", `${p.page_no}.webp`), readFileSync(storage.file("store-pages", p.path)));
    writeFileSync(path.join(out, "pages", "meta.json"), JSON.stringify(pages.map((p) => ({ n: p.page_no, w: p.width, h: p.height }))));
    console.log("[store-local-pdf]", JSON.stringify(report));
  });
});
