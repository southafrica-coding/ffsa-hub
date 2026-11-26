import { NextResponse } from "next/server";
import sharp from "sharp";
import { storeAdminClient } from "@/lib/store/db";
import { getProduct } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

export const runtime = "nodejs";

// POST /api/store/admin/products/[id]/cover — upload a cover image. Resized
// to 1200px WebP and kept in the private store-covers bucket; served by
// /api/store/cover/[id].
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data: product } = await getProduct(guard.supabase, id);
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return NextResponse.json({ error: "Upload a JPG, PNG or WebP" }, { status: 400 });
  }
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Keep covers under 4 MB" }, { status: 400 });

  const webp = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const path = `${id}/cover-${Date.now()}.webp`;
  const admin = storeAdminClient();
  const up = await admin.storage.from("store-covers").upload(path, webp, { contentType: "image/webp" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const { error } = await guard.supabase.from("store_products").update({ cover_image_url: path, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, cover: path });
}
