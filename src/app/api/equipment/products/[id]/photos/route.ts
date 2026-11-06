import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getEquipmentAccess, getProductById, insertProductPhoto, listProductPhotos } from "@/services/equipment";
import { PHOTO_BUCKET, newListingPhotoPath, photoUrl, readListingPhotoUpload } from "@/lib/equipment/photos";

const MAX_PHOTOS = 12;

// POST /api/equipment/products/[id]/photos — multipart upload of one listing
// photo into the public equipment-photos bucket. Rental manager only; the
// object is written with the service role (as vehicle inspections are), the
// row through RLS.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can change listings." }, { status: 403 });
  }

  const { data: product } = await getProductById(supabase, id);
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const upload = await readListingPhotoUpload(request);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });
  const { file, ext } = upload;

  const { data: existing } = await listProductPhotos(supabase, [id]);
  if ((existing?.length ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json({ error: `A listing can have up to ${MAX_PHOTOS} photos` }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = newListingPhotoPath(id, ext);
  const stored = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (stored.error) return NextResponse.json({ error: stored.error.message }, { status: 500 });

  const { data, error } = await insertProductPhoto(supabase, {
    product_id: id,
    file_path: path,
    alt: product.name,
    sort_order: existing?.length ?? 0,
  });
  if (error) {
    await admin.storage.from(PHOTO_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, photo: { ...data, url: photoUrl(path) } });
}
