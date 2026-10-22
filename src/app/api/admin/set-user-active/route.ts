import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, is_active } = body;

  if (!user_id || typeof is_active !== "boolean") {
    return NextResponse.json(
      { error: "user_id and is_active (boolean) are required" },
      { status: 400 }
    );
  }

  if (user_id === authUser.id && !is_active) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  // A General Admin can't switch off a super admin (that is the super
  // admin's own tier, like granting or removing super_admin).
  if (!is_active && !(await callerIsSuperAdmin(supabase, authUser.id))) {
    const { data: targetSuper } = await adminSupabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", user_id)
      .eq("roles.name", "super_admin")
      .limit(1);
    if (targetSuper && targetSuper.length > 0) {
      return NextResponse.json(
        { error: "Only a super admin can deactivate a super admin" },
        { status: 403 }
      );
    }
  }

  const { error: updateError } = await adminSupabase
    .from("users")
    .update({ is_active })
    .eq("id", user_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "users",
    resource_id: user_id,
    changes: { is_active },
  });

  return NextResponse.json({ success: true });
}
