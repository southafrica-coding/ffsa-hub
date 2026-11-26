import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { accessFor, PDF_DOWNLOAD_LIMIT, PDF_DOWNLOADS_USED_UP, pdfEntitlementsFor } from "@/lib/store/entitlements";
import { buildLowResPdf } from "@/lib/store/pdf/low-res-pdf";
import { PDF_URL_TTL_SECONDS } from "@/lib/store/signing";
import { slugify } from "@/lib/store/catalogue";
import type { StoreAssetPage, StoreEntitlement } from "@/lib/store/types";
import { getActiveAsset, getProduct, listEntitlementsFor, listPages, returnPdfDownload, takePdfDownload } from "@/services/store";
import { bad } from "../../../_shared";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/store/library/[productId]/pdf — Print + Digital buyers only.
// Builds a clean low-res PDF from the stored page images (no watermark, no
// buyer details; cached once per asset in the private bucket) and redirects
// to a signed URL that lives PDF_URL_TTL_SECONDS. The source PDF is never
// served. The cache key is new: older per-buyer files under pdf/<user>/ were
// watermarked and are never served again.
//
// Each Print + Digital entitlement gets PDF_DOWNLOAD_LIMIT (3) signed URLs.
// A slot is taken atomically (store_take_pdf_download) before the URL is
// signed, and given back if the PDF can't be prepared.
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) return bad("Sign in first", 401);

  const admin = storeAdminClient();
  const { data: ents } = await listEntitlementsFor(admin, buyer);
  const all = (ents ?? []) as StoreEntitlement[];
  const access = accessFor(all, buyer, productId);
  if (!access.pdf) return bad("The PDF comes with Print + Digital only", 403);

  const [{ data: product }, { data: asset }] = await Promise.all([getProduct(admin, productId), getActiveAsset(admin, productId)]);
  if (!product || !asset || asset.status !== "ready") return bad("This isn't ready yet", 409);

  const pdfEnts = pdfEntitlementsFor(all, buyer, productId);
  const { data: charged, error: takeError } = await takePdfDownload(admin, pdfEnts.map((e) => e.id), PDF_DOWNLOAD_LIMIT);
  if (takeError) return bad("We couldn't prepare the PDF. Try again.", 500);
  if (!charged) return bad(PDF_DOWNLOADS_USED_UP, 403);

  const failed = async (message: string) => {
    await returnPdfDownload(admin, charged);
    return bad(message, 500);
  };

  try {
    const bucket = admin.storage.from("store-pages");
    const path = `pdf/clean/${asset.id}.pdf`;
    const filename = `${slugify(product.title) || "store"}.pdf`;

    let signed = await bucket.createSignedUrl(path, PDF_URL_TTL_SECONDS, { download: filename });
    if (signed.error || !signed.data) {
      const { data: pages } = await listPages(admin, asset.id);
      const images: Buffer[] = [];
      for (const p of (pages ?? []) as StoreAssetPage[]) {
        const { data: file } = await bucket.download(p.path);
        if (!file) return failed("A page is missing. Media has been told.");
        images.push(Buffer.from(await file.arrayBuffer()));
      }
      const pdf = await buildLowResPdf(images, product.title);
      const up = await bucket.upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) return failed("We couldn't prepare the PDF. Try again.");
      signed = await bucket.createSignedUrl(path, PDF_URL_TTL_SECONDS, { download: filename });
      if (signed.error || !signed.data) return failed("We couldn't prepare the PDF. Try again.");
    }
    return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch {
    return failed("We couldn't prepare the PDF. Try again.");
  }
}
