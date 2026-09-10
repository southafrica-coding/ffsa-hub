import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  callerIsSuperAdmin,
  callerCanManageRoles,
  SUPER_ADMIN_ONLY_ROLES,
} from "@/lib/auth/check-role-grant";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { user_id, role_name, role_id, scope_type, scope_id } = body;
  if (!user_id || (!role_name && !role_id)) {
    return NextResponse.json(
      { error: "user_id and role_name or role_id are required" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  const { data: role } = role_id
    ? await adminSupabase.from("roles").select("id, name").eq("id", role_id).single()
    : await adminSupabase.from("roles").select("id, name").eq("name", role_name).single();
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  // Authorize. super_admin removal keeps its strict guards; other roles
  // need manage-roles. (Removing a role only ever reduces access, so the
  // subset guardrail isn't needed here.)
  const isSuper = await callerIsSuperAdmin(supabase, authUser.id);
  if (SUPER_ADMIN_ONLY_ROLES.includes(role.name)) {
    // Top-tier roles are a super admin's call in both directions — a
    // manage_roles holder should not be able to strip a General Admin either.
    if (!isSuper) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }
  if (role.name === "super_admin") {
    if (user_id === authUser.id) {
      return NextResponse.json(
        { error: "You cannot remove your own super_admin role" },
        { status: 400 }
      );
    }
    const { count } = await adminSupabase
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role_id", role.id);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last super_admin" },
        { status: 400 }
      );
    }
  } else if (!isSuper && !(await callerCanManageRoles(supabase, authUser.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Delete the specific assignment (respecting scope)
  let del = adminSupabase
    .from("user_roles")
    .delete()
    .eq("user_id", user_id)
    .eq("role_id", role.id);
  if (scope_type && scope_id) {
    del = del.eq("scope_type", scope_type).eq("scope_id", scope_id);
  } else {
    del = del.is("scope_type", null).is("scope_id", null);
  }
  const { error: deleteError } = await del;
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "delete",
    resource_type: "user_roles",
    resource_id: user_id,
    changes: {
      role: role.name,
      revoked_from: user_id,
      scope_type: scope_type ?? null,
      scope_id: scope_id ?? null,
    },
  });

  return NextResponse.json({ success: true });
}
