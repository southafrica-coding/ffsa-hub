import { storeAdminClient } from "@/lib/store/db";
import { verifyPageQuery, PREVIEW_VIEWER } from "@/lib/store/signing";
import { watermarkPage, watermarkText } from "@/lib/store/pdf/watermark";
import { getAsset, getPage } from "@/services/store";

export const runtime = "nodejs";

// GET /api/store/page?a&p&v&e&s — one page image, watermarked for the
// viewer named in the signed token. The token was issued only after an
// entitlement check (or, for v=preview, only for a preview page — checked
// again here). Unwatermarked pages never leave the server.
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

  const label = isPreview ? "Preview · Fire & Fragrance Store" : watermarkText(claim.viewer);
  const stamped = await watermarkPage(Buffer.from(await file.arrayBuffer()), label);
  return new Response(new Uint8Array(stamped), {
    headers: {
      "Content-Type": "image/webp",
      // Private: the image carries the reader's email. The reader's service
      // worker keeps its own copy for offline reading.
      "Cache-Control": `private, max-age=${Math.max(0, claim.expiresAt - Math.floor(Date.now() / 1000))}`,
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex",
    },
  });
}
