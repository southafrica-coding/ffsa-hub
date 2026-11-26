import { storeAdminClient } from "@/lib/store/db";
import { verifyPageQuery, PREVIEW_VIEWER } from "@/lib/store/signing";
import { getAsset, getPage } from "@/services/store";

export const runtime = "nodejs";

// GET /api/store/page?a&p&v&e&s — one page image for the flipbook. The
// token was issued only after an entitlement check (or, for v=preview, only
// for a preview page — checked again here). The stored WebP is served as
// is: on-site pages carry no watermark. Only the Print + Digital PDF is
// stamped with the buyer's email (library/[productId]/pdf).
export async function GET(request: Request) {
  const verdict = verifyPageQuery(new URL(request.url).searchParams);
  if (!verdict.ok) return new Response(verdict.reason === "expired" ? "Link expired" : "Not found", { status: verdict.reason === "expired" ? 410 : 404 });
  const { claim } = verdict;

  const admin = storeAdminClient();
  const [{ data: asset }, { data: page }] = await Promise.all([getAsset(admin, claim.assetId), getPage(admin, claim.assetId, claim.page)]);
  if (!asset || !asset.is_active || !page) return new Response("Not found", { status: 404 });
  const isPreview = claim.viewer === PREVIEW_VIEWER;
  if (isPreview && !page.is_preview) return new Response("Not found", { status: 404 });

  const { data: file, error } = await admin.storage.from("store-pages").download(page.path);
  if (error || !file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(await file.arrayBuffer()), {
    headers: {
      "Content-Type": "image/webp",
      // Private and only as long as the signed link lives. The reader's
      // service worker keeps its own copy for offline reading.
      "Cache-Control": `private, max-age=${Math.max(0, claim.expiresAt - Math.floor(Date.now() / 1000))}`,
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex",
    },
  });
}
