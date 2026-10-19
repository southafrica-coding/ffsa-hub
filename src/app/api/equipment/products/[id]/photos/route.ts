import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getEquipmentAccess, getProductById, insertProductPhoto, listProductPhotos } from "@/services/equipment";
import { PHOTO_BUCKET, photoUrl } from "@/lib/equipment/photos";

const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024;
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "Photos must be JPG, PNG or WEBP" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photos must be 8 MB or smaller" }, { status: 400 });

  const { data: existing } = await listProductPhotos(supabase, [id]);
  if ((existing?.length ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json({ error: `A listing can have up to ${MAX_PHOTOS} photos` }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = `${id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  const upload = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });

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
