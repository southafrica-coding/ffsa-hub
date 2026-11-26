// ============================================================
// Store — cover images
// ============================================================
// What a tile, card, product page or cart line shows as a product's cover:
//   1. the cover image Media uploaded (/api/store/cover/[id]), if there is one;
//   2. otherwise page 1 of the live PDF render, but only when page 1 is a
//      preview page — signed exactly like the public preview flipbook
//      (viewer "preview"), so /api/store/page checks is_preview again;
//   3. otherwise null, and the UI draws the title box.
// It never signs a non-preview page, a reader (buyer) URL, or anything
// pointing at the source PDF.
//
// The link's expiry is rounded to a window so the same URL is reused for a
// while (the browser can cache it) and always has at least
// COVER_URL_WINDOW_SECONDS left when the page is rendered.
// ============================================================

import "server-only";
import type { StoreClient } from "@/lib/store/db";
import type { StoreAsset, StoreAssetPage, StoreProduct } from "@/lib/store/types";
import { getActiveAsset, getPage } from "@/services/store";
import { pageUrl, PREVIEW_VIEWER } from "./signing";

export const COVER_PAGE = 1;
export const COVER_URL_WINDOW_SECONDS = 60 * 60;

type CoverProduct = Pick<StoreProduct, "id" | "status" | "cover_image_url">;

/**
 * The signed preview URL for page 1 of `asset`, or null. Pure: the caller
 * passes the asset and page rows it loaded.
 */
export function coverPageUrl(
  asset: Pick<StoreAsset, "id" | "status" | "is_active"> | null | undefined,
  page: Pick<StoreAssetPage, "asset_id" | "page_no" | "is_preview"> | null | undefined,
  opts: { now?: number; key?: string } = {}
): string | null {
  if (!asset || !asset.is_active || asset.status !== "ready") return null;
  if (!page || page.asset_id !== asset.id || page.page_no !== COVER_PAGE || page.is_preview !== true) return null;
  const windowMs = COVER_URL_WINDOW_SECONDS * 1000;
  const start = Math.floor((opts.now ?? Date.now()) / windowMs) * windowMs;
  return pageUrl({ assetId: asset.id, page: COVER_PAGE, viewer: PREVIEW_VIEWER }, { now: start, ttlSeconds: COVER_URL_WINDOW_SECONDS * 2, key: opts.key });
}

/**
 * The cover src for one product, or null for the title box.
 * `requirePublished` (default true) is for public surfaces; My Library
 * passes false so a buyer still sees the cover of something they own after
 * it's taken off sale.
 */
export async function coverSrcFor(
  admin: StoreClient,
  product: CoverProduct,
  opts: { requirePublished?: boolean; now?: number; key?: string } = {}
): Promise<string | null> {
  // Published check first: an unpublished product must not show a Media
  // cover (or a page-1 render) on public surfaces.
  if ((opts.requirePublished ?? true) && product.status !== "published") return null;
  if (product.cover_image_url) return `/api/store/cover/${product.id}`;
  try {
    const { data: asset } = await getActiveAsset(admin, product.id);
    if (!asset || asset.status !== "ready") return null;
    const { data: page } = await getPage(admin, asset.id, COVER_PAGE);
    return coverPageUrl(asset as StoreAsset, page as StoreAssetPage | null, opts);
  } catch {
    return null;
  }
}

/** coverSrcFor for a list, keyed by product id. */
export async function coverSrcsFor(
  admin: StoreClient,
  products: CoverProduct[],
  opts: { requirePublished?: boolean; now?: number; key?: string } = {}
): Promise<Record<string, string | null>> {
  const srcs = await Promise.all(products.map((p) => coverSrcFor(admin, p, opts)));
  return Object.fromEntries(products.map((p, i) => [p.id, srcs[i]]));
}
