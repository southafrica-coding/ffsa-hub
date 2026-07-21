import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";

// Rename / reorder a sub-category. Admins only. Scoped to both the ministry
// and the sub-category so one ministry can't touch another's rows.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  const { id, subId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: { name?: string; sort_order?: number; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data, error } = await admin
    .from("staff_ministry_subcategories")
    .update(patch)
    .eq("id", subId)
    .eq("staff_ministry_id", id)
    .select("id, staff_ministry_id, name, sort_order")
    .maybeSingle();
  if (error) {
    const msg =
      error.code === "23505"
        ? "A category with that name already exists"
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!data)
    return NextResponse.json({ error: "Category not found" }, { status: 404 });

  return NextResponse.json({ success: true, subcategory: data });
}

// Delete a sub-category. Admins only. Its members fall back to Uncategorized
// (ON DELETE SET NULL on staff_ministry_members.subcategory_id).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  const { id, subId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { error } = await admin
    .from("staff_ministry_subcategories")
    .delete()
    .eq("id", subId)
    .eq("staff_ministry_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
