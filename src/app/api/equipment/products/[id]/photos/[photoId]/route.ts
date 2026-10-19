import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { deleteProductPhoto, getEquipmentAccess } from "@/services/equipment";
import { PHOTO_BUCKET } from "@/lib/equipment/photos";

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
