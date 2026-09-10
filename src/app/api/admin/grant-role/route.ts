import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  callerIsSuperAdmin,
  callerCanManageRoles,
  callerCanGrantPermissionKeys,
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
  // role_permissions isn't in the generated DB types until 089's types are
  // regenerated; cast for those calls (matches the codebase pattern).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = adminSupabase as any;

  // Resolve the role (by id or name)
  const { data: role } = role_id
    ? await adminSupabase.from("roles").select("id, name").eq("id", role_id).single()
    : await adminSupabase.from("roles").select("id, name").eq("name", role_name).single();
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  // Authorize
  const isSuper = await callerIsSuperAdmin(supabase, authUser.id);
  if (SUPER_ADMIN_ONLY_ROLES.includes(role.name)) {
    // super_admin and admin (General Admin) are top-tier: only a super admin
    // hands them out. The subset guardrail below cannot police them — neither
    // role has any role_permissions rows, so it would pass vacuously.
    if (!isSuper) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  } else if (!isSuper) {
    if (!(await callerCanManageRoles(supabase, authUser.id))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    // Guardrail: only assign a role whose capabilities the caller holds
    const { data: rolePerms } = await adminAny
      .from("role_permissions")
      .select("permissions!inner(key)")
      .eq("role_id", role.id);
    const keys = ((rolePerms ?? []) as Array<{
      permissions: { key: string } | { key: string }[];
    }>).map((r) =>
      Array.isArray(r.permissions) ? r.permissions[0].key : r.permissions.key
    );
    if (!(await callerCanGrantPermissionKeys(supabase, authUser.id, keys))) {
      return NextResponse.json(
        { error: "You can only assign roles whose capabilities you hold" },
        { status: 403 }
      );
    }
  }

  // Target user must exist
  const { data: targetUser } = await adminSupabase
    .from("users")
    .select("id")
    .eq("id", user_id)
    .single();
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Re-granting a role someone already holds is a no-op, not an error — an
  // admin can click Grant twice, or grant a role that signup automation
  // already gave them. ON CONFLICT can't be relied on here: the unscoped case
  // has NULL scope columns, and NULLs never match a conflict target, so the
  // check has to be explicit (see migration 209).
  const existingQuery = adminSupabase
    .from("user_roles")
    .select("id")
    .eq("user_id", user_id)
    .eq("role_id", role.id)
    .limit(1);
  const { data: existing } = scope_id
    ? await existingQuery.eq("scope_type", scope_type ?? null).eq("scope_id", scope_id)
    : await existingQuery.is("scope_type", null).is("scope_id", null);

  if (!existing || existing.length === 0) {
    const { error: insertError } = await adminSupabase.from("user_roles").insert({
      user_id,
      role_id: role.id,
      scope_type: scope_type ?? null,
      scope_id: scope_id ?? null,
      assigned_by: authUser.id,
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "create",
    resource_type: "user_roles",
    resource_id: user_id,
    changes: {
      role: role.name,
      granted_to: user_id,
      scope_type: scope_type ?? null,
      scope_id: scope_id ?? null,
    },
  });

  return NextResponse.json({ success: true });
}
