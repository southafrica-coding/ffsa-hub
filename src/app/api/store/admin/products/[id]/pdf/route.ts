import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { kindHasFlipbook } from "@/lib/store/catalogue";
import { MAX_PDF_BYTES, validatePdfUpload } from "@/lib/store/upload";
import { createAsset, getProduct } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// POST /api/store/admin/products/[id]/pdf — step 1 of a PDF upload.
//
// Body (JSON, metadata only — NEVER the file): { filename, contentType, size }.
// Returns a short-lived signed upload token for the PRIVATE store-source
// bucket. The browser then PUTs the PDF straight to Supabase Storage and
// calls POST /api/store/admin/assets/[assetId]/complete.
//
// The file must not come through here: Vercel caps function request bodies
// at 4.5 MB and a real Review is 20+ MB. See src/lib/store/upload.ts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;

  const parsed = validatePdfUpload(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, maxBytes: MAX_PDF_BYTES }, { status: parsed.status });

  const { data: product } = await getProduct(guard.supabase, id);
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!kindHasFlipbook(product.kind)) return NextResponse.json({ error: "Merch has no PDF" }, { status: 400 });

  // The storage path is ours, never the uploaded file name.
  const assetId = randomUUID();
  const path = `${id}/${assetId}.pdf`;
  const admin = storeAdminClient();
  const { data: signed, error: signErr } = await admin.storage.from("store-source").createSignedUploadUrl(path);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Couldn't start the upload" }, { status: 500 });

  const { error } = await createAsset(guard.supabase, {
    id: assetId,
    product_id: id,
    source_path: path,
    uploaded_by: guard.userId,
    filename: parsed.value.filename,
    byte_size: parsed.value.size,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, assetId, bucket: "store-source", path, token: signed.token, maxBytes: MAX_PDF_BYTES });
}
