import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { kindHasFlipbook } from "@/lib/store/catalogue";
import { createAsset, getProduct } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// POST /api/store/admin/products/[id]/pdf — start a PDF upload.
// Returns a one-time signed upload URL for the PRIVATE store-source bucket
// (the browser uploads straight to Storage, so big PDFs skip the serverless
// body limit). Then call POST /api/store/admin/assets/[assetId]/render.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data: product } = await getProduct(guard.supabase, id);
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!kindHasFlipbook(product.kind)) return NextResponse.json({ error: "Merch has no PDF" }, { status: 400 });

  const assetId = randomUUID();
  const path = `${id}/${assetId}.pdf`;
  const admin = storeAdminClient();
  const { data: signed, error: signErr } = await admin.storage.from("store-source").createSignedUploadUrl(path);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Couldn't start the upload" }, { status: 500 });

  const { error } = await createAsset(guard.supabase, { id: assetId, product_id: id, source_path: path, uploaded_by: guard.userId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, assetId, bucket: "store-source", path, token: signed.token });
}
