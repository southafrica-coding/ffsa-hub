import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, storeRpcs, type MemoryDb } from "../testing/memory-db";
import { catalogue, IDS } from "../testing/fixtures";
import { hashDeviceId } from "../devices";
import { PDF_DOWNLOAD_LIMIT, PDF_DOWNLOADS_USED_UP, pdfDownloadsLeft } from "../entitlements";

vi.mock("server-only", () => ({}));

// Jack: each Print + Digital entitlement gets 3 PDF downloads. A download is
// one signed URL issued by GET /api/store/library/[productId]/pdf; the slot
// is taken atomically (store_take_pdf_download) and given back if the PDF
// can't be prepared. Made-up buyers and ids only.

let db: MemoryDb;
let who: { id: string; email: string; email_confirmed_at?: string | null } | null = null;
/** The private bucket: the cached clean PDF either signs, or (fail) can't be prepared. */
let storageMode: "ok" | "fail" = "ok";
let signs = 0;

const storage = {
  from: () => ({
    createSignedUrl: async () => {
      // Let other overlapping requests run between taking a slot and signing.
      await new Promise((r) => setTimeout(r, 1));
      if (storageMode === "fail") return { data: null, error: { message: "not found" } };
      signs++;
      return { data: { signedUrl: `https://storage.test/pdf/clean/asset-1.pdf?token=${signs}` }, error: null };
    },
    download: async () => ({ data: null, error: { message: "missing" } }),
    upload: async () => ({ data: null, error: { message: "nope" } }),
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: db.client.from, rpc: db.client.rpc, auth: { getUser: async () => ({ data: { user: who }, error: null }) } }),
}));
vi.mock("@/lib/store/db", () => ({ storeAdminClient: () => ({ ...db.client, storage }) }));

const BUYER = { id: "buyer-1", email: "reader@example.org", email_confirmed_at: "2026-01-01T00:00:00Z" };
const DEVICE = "device-0123456789abcdef";

const ent = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  product_id: IDS.bundle,
  email: BUYER.email,
  user_id: BUYER.id,
  source: "purchase",
  order_item_id: null,
  code_id: null,
  includes_pdf: true,
  pdf_downloads_used: 0,
  starts_at: "2026-01-01T00:00:00Z",
  expires_at: null,
  revoked_at: null,
  created_at,
  ...extra,
});

function seed(entitlements: Record<string, unknown>[]) {
  db = createMemoryDb(
    {
      store_products: catalogue.products,
      store_variants: catalogue.variants,
      store_assets: [{ id: "asset-1", product_id: IDS.bundle, is_active: true, status: "ready" }],
      store_asset_pages: [{ id: "p1", asset_id: "asset-1", page_no: 1, width: 600, height: 800, path: "pages/asset-1/1.webp" }],
      store_devices: [{ id: "d1", user_id: BUYER.id, device_hash: hashDeviceId(DEVICE), label: "Phone", removed_at: null }],
      store_entitlements: entitlements,
    },
    { rpc: storeRpcs }
  );
}

async function download() {
  const { GET } = await import("@/app/api/store/library/[productId]/pdf/route");
  return GET(new Request("https://hub.test/x"), { params: Promise.resolve({ productId: IDS.bundle }) });
}

async function downloadsLeft() {
  const { GET } = await import("@/app/api/store/library/[productId]/pages/route");
  const res = await GET(new Request("https://hub.test/x", { headers: { "x-store-device": DEVICE } }), { params: Promise.resolve({ productId: IDS.bundle }) });
  expect(res.status).toBe(200);
  return (await res.json()).downloadsLeft as number;
}

const used = (id: string) => db.table("store_entitlements").find((r) => r.id === id)!.pdf_downloads_used;

beforeEach(() => {
  who = BUYER;
  storageMode = "ok";
  signs = 0;
  vi.stubEnv("STORE_SIGNING_SECRET", "local-test-secret-0123456789");
});

describe("Print + Digital PDF: 3 downloads per entitlement", () => {
  it("the limit and the exact message", () => {
    expect(PDF_DOWNLOAD_LIMIT).toBe(3);
    expect(PDF_DOWNLOADS_USED_UP).toBe("You've used all 3 downloads for this purchase. You can still read it in your library.");
    expect(pdfDownloadsLeft([{ pdf_downloads_used: 0 }, { pdf_downloads_used: 2 }, { pdf_downloads_used: 3 }])).toBe(4);
  });

  it("the 3rd successful issue takes the count to 3 and still redirects to a signed URL", async () => {
    seed([ent("ent-1", "2026-02-01T00:00:00Z")]);
    expect(await downloadsLeft()).toBe(3);
    for (let i = 1; i <= 3; i++) {
      const res = await download();
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toMatch(/^https:\/\/storage\.test\/pdf\/clean\/asset-1\.pdf\?token=/);
      expect(used("ent-1")).toBe(i);
    }
    expect(signs).toBe(3);
    expect(await downloadsLeft()).toBe(0);
  });

  it("the 4th is refused with the exact message: no 4th increment, no URL", async () => {
    seed([ent("ent-1", "2026-02-01T00:00:00Z", { pdf_downloads_used: 3 })]);
    const res = await download();
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "You've used all 3 downloads for this purchase. You can still read it in your library." });
    expect(used("ent-1")).toBe(3);
    expect(signs).toBe(0);
  });

  it("concurrency: 8 overlapping requests on one entitlement — 3 succeed, the rest get the exhausted message", async () => {
    seed([ent("ent-1", "2026-02-01T00:00:00Z")]);
    const results = await Promise.all(Array.from({ length: 8 }, () => download()));
    const ok = results.filter((r) => r.status === 303);
    const refused = results.filter((r) => r.status === 403);
    expect(ok).toHaveLength(3);
    expect(refused).toHaveLength(5);
    for (const r of refused) expect((await r.json()).error).toBe(PDF_DOWNLOADS_USED_UP);
    expect(used("ent-1")).toBe(3);
    expect(signs).toBe(3);
  });

  it("counts per entitlement: two purchases are 3 + 3, the oldest is used first", async () => {
    seed([ent("ent-new", "2026-03-01T00:00:00Z"), ent("ent-old", "2026-02-01T00:00:00Z")]);
    expect(await downloadsLeft()).toBe(6);
    for (let i = 0; i < 3; i++) expect((await download()).status).toBe(303);
    expect([used("ent-old"), used("ent-new")]).toEqual([3, 0]);
    for (let i = 0; i < 3; i++) expect((await download()).status).toBe(303);
    expect([used("ent-old"), used("ent-new")]).toEqual([3, 3]);
    expect((await download()).status).toBe(403);
    expect(await downloadsLeft()).toBe(0);
  });

  it("revoked, read-only or someone else's entitlements don't count", async () => {
    seed([
      ent("ent-1", "2026-02-01T00:00:00Z", { pdf_downloads_used: 3 }),
      ent("ent-revoked", "2026-02-02T00:00:00Z", { revoked_at: "2026-02-03T00:00:00Z" }),
      ent("ent-read", "2026-02-02T00:00:00Z", { includes_pdf: false }),
      ent("ent-other", "2026-02-02T00:00:00Z", { email: "someone@example.org", user_id: "buyer-2" }),
    ]);
    expect(await downloadsLeft()).toBe(0);
    expect((await download()).status).toBe(403);
    expect([used("ent-revoked"), used("ent-read"), used("ent-other")]).toEqual([0, 0, 0]);
  });

  it("a PDF that can't be prepared gives the download back", async () => {
    seed([ent("ent-1", "2026-02-01T00:00:00Z", { pdf_downloads_used: 2 })]);
    storageMode = "fail";
    const res = await download();
    expect(res.status).toBe(500);
    expect(used("ent-1")).toBe(2);
    storageMode = "ok";
    expect((await download()).status).toBe(303);
    expect(used("ent-1")).toBe(3);
  });
});
