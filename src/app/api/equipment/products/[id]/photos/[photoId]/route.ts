import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { deleteProductPhoto, getEquipmentAccess, getProductPhoto, updateProductPhoto } from "@/services/equipment";
import { PHOTO_BUCKET, newListingPhotoPath, photoUrl, readListingPhotoUpload } from "@/lib/equipment/photos";

// PATCH /api/equipment/products/[id]/photos/[photoId] — replace one listing
// photo in place. A new object is written, the row keeps its id and
// sort_order, then the previous object is removed. Rental manager only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can change listings." }, { status: 403 });
  }

  const { data: existing, error: lookupError } = await getProductPhoto(supabase, photoId);
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!existing || existing.product_id !== id) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const upload = await readListingPhotoUpload(request);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });

  const admin = createAdminClient();
  const path = newListingPhotoPath(id, upload.ext);
  const stored = await admin.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(await upload.file.arrayBuffer()), {
    contentType: upload.file.type,
    upsert: false,
  });
  if (stored.error) return NextResponse.json({ error: stored.error.message }, { status: 500 });

  const { data, error } = await updateProductPhoto(supabase, photoId, {
    file_path: path,
    ...(upload.alt !== undefined ? { alt: upload.alt } : {}),
  });
  if (error || !data) {
    await admin.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  if (existing.file_path && existing.file_path !== path) {
    const removed = await admin.storage.from(PHOTO_BUCKET).remove([existing.file_path]);
    if (removed.error) {
      return NextResponse.json(
        {
          error: "The photo was replaced, but the previous file could not be removed.",
          photo: { ...data, url: photoUrl(path) },
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, photo: { ...data, url: photoUrl(path) } });
}

// DELETE /api/equipment/products/[id]/photos/[photoId] — remove a listing photo.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can change listings." }, { status: 403 });
  }

  const { data, error } = await deleteProductPhoto(supabase, photoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.product_id !== id) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  await createAdminClient().storage.from(PHOTO_BUCKET).remove([data.file_path]);
  return NextResponse.json({ success: true });
}
