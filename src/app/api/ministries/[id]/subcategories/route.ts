import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { createSubcategory } from "@/services/ministries";

// Create a sub-category under a ministry. Admins only (the sub-category LIST is
// admin-managed; assigning members into one is handled by the members route).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await createSubcategory(admin, {
    staff_ministry_id: id,
    name,
    sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
  });
  if (error) {
    const msg =
      error.code === "23505"
        ? "A category with that name already exists"
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ success: true, subcategory: data });
}
