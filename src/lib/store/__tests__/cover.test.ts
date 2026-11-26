import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../testing/memory-db";
import { draft, review, sub, IDS } from "../testing/fixtures";
import { COVER_PAGE, COVER_URL_WINDOW_SECONDS, coverPageUrl, coverSrcFor, coverSrcsFor } from "../cover";
import { PREVIEW_VIEWER, verifyPageQuery } from "../signing";

vi.mock("server-only", () => ({}));

const KEY = "test-signing-key-0123456789";
const NOW = Date.UTC(2026, 10, 26, 10, 17, 0);
const ASSET = "00000000-0000-4000-8000-0000000000f1";
const OLD_ASSET = "00000000-0000-4000-8000-0000000000f2";

const asset = { id: ASSET, product_id: IDS.review, status: "ready", is_active: true, page_count: 12 };
const page = (n: number, is_preview: boolean, asset_id = ASSET) => ({ asset_id, page_no: n, path: `${asset_id}/${String(n).padStart(4, "0")}.webp`, width: 1240, height: 1754, is_preview });

function db(seed: Record<string, Record<string, unknown>[]>) {
  return createMemoryDb(seed).client;
}

function claimOf(url: string) {
  expect(url.startsWith("/api/store/page?")).toBe(true);
  const v = verifyPageQuery(new URL(url, "https://store.test").searchParams, { key: KEY, now: NOW });
  if (!v.ok) throw new Error(`bad url: ${v.reason}`);
  return v.claim;
}

describe("coverPageUrl", () => {
  it("signs page 1 as a preview page when it is one", () => {
    const url = coverPageUrl(asset as never, page(1, true), { now: NOW, key: KEY })!;
    const claim = claimOf(url);
    expect(claim).toMatchObject({ assetId: ASSET, page: COVER_PAGE, viewer: PREVIEW_VIEWER });
    // At least one whole window left, and the URL is stable inside the window.
    expect(claim.expiresAt - NOW / 1000).toBeGreaterThanOrEqual(COVER_URL_WINDOW_SECONDS);
    expect(coverPageUrl(asset as never, page(1, true), { now: NOW + 20 * 60_000, key: KEY })).toBe(url);
  });

  it("gives nothing when page 1 isn't a preview page, or for any other page", () => {
    expect(coverPageUrl(asset as never, page(1, false), { now: NOW, key: KEY })).toBeNull();
    expect(coverPageUrl(asset as never, page(2, true), { now: NOW, key: KEY })).toBeNull();
    expect(coverPageUrl(asset as never, page(1, true, OLD_ASSET), { now: NOW, key: KEY })).toBeNull();
  });

  it("gives nothing without a live, ready render", () => {
    expect(coverPageUrl(null, page(1, true), { key: KEY })).toBeNull();
    expect(coverPageUrl(asset as never, null, { key: KEY })).toBeNull();
    expect(coverPageUrl({ ...asset, status: "rendering" } as never, page(1, true), { key: KEY })).toBeNull();
    expect(coverPageUrl({ ...asset, status: "failed" } as never, page(1, true), { key: KEY })).toBeNull();
    expect(coverPageUrl({ ...asset, is_active: false } as never, page(1, true), { key: KEY })).toBeNull();
  });
});

describe("coverSrcFor", () => {
  it("falls back to null (title box) when there's no render", async () => {
    expect(await coverSrcFor(db({}), review, { key: KEY })).toBeNull();
    expect(await coverSrcFor(db({ store_assets: [{ ...asset, status: "failed" }] }), review, { key: KEY })).toBeNull();
    // A ready asset whose page 1 row is missing.
    expect(await coverSrcFor(db({ store_assets: [asset], store_asset_pages: [page(2, true)] }), review, { key: KEY })).toBeNull();
  });

  it("returns the signed page-1 preview URL when the render exists", async () => {
    const client = db({ store_assets: [asset], store_asset_pages: [page(1, true), page(2, true), page(3, false)] });
    const url = (await coverSrcFor(client, review, { now: NOW, key: KEY }))!;
    expect(claimOf(url)).toMatchObject({ assetId: ASSET, page: 1, viewer: PREVIEW_VIEWER });
  });

  it("never signs a non-preview page 1, a reader URL, or the PDF", async () => {
    const client = db({ store_assets: [{ ...asset, source_path: `${IDS.review}/source.pdf` }], store_asset_pages: [page(1, false), page(2, true)] });
    expect(await coverSrcFor(client, review, { now: NOW, key: KEY })).toBeNull();

    const ok = db({ store_assets: [asset], store_asset_pages: [page(1, true)] });
    const url = new URL((await coverSrcFor(ok, review, { now: NOW, key: KEY }))!, "https://store.test");
    // Only the page-image route, only page 1, only as the preview viewer.
    expect(url.pathname).toBe("/api/store/page");
    expect([...url.searchParams.keys()].sort()).toEqual(["a", "e", "p", "s", "v"]);
    expect(url.searchParams.get("p")).toBe("1");
    expect(url.searchParams.get("v")).toBe(PREVIEW_VIEWER);
  });

  it("ignores inactive (old) renders", async () => {
    const client = db({ store_assets: [{ ...asset, id: OLD_ASSET, is_active: false }], store_asset_pages: [page(1, true, OLD_ASSET)] });
    expect(await coverSrcFor(client, review, { key: KEY })).toBeNull();
  });

  it("prefers an uploaded cover image", async () => {
    const client = db({ store_assets: [asset], store_asset_pages: [page(1, true)] });
    expect(await coverSrcFor(client, { ...review, cover_image_url: "x/cover.webp" }, { key: KEY })).toBe(`/api/store/cover/${IDS.review}`);
  });

  it("hides unpublished products' renders on public surfaces, not in the library", async () => {
    const client = db({ store_assets: [{ ...asset, product_id: IDS.draft }], store_asset_pages: [page(1, true)] });
    expect(await coverSrcFor(client, draft, { key: KEY })).toBeNull();
    expect(await coverSrcFor(client, draft, { requirePublished: false, now: NOW, key: KEY })).not.toBeNull();
  });

  it("returns null instead of throwing when the lookup fails", async () => {
    const broken = { from: () => { throw new Error("db down"); } };
    expect(await coverSrcFor(broken, review, { key: KEY })).toBeNull();
  });
});

describe("coverSrcsFor", () => {
  it("keys covers by product id, with null for the title box", async () => {
    const client = db({ store_assets: [asset], store_asset_pages: [page(1, true)] });
    const out = await coverSrcsFor(client, [review, sub], { now: NOW, key: KEY });
    expect(Object.keys(out).sort()).toEqual([IDS.review, IDS.sub].sort());
    expect(out[IDS.review]).toMatch(/^\/api\/store\/page\?/);
    expect(out[IDS.sub]).toBeNull();
  });
});
