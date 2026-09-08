import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";

// Converts a person to a plain community member — the "they've left staff"
// action.
//
// This is deliberately NOT what the Role dropdown on /users does. That control
// (/api/admin/set-membership-role) only swaps the membership role and leaves
// every actual grant of access in place: job titles, super_admin, per-person
// permission grants, and staff ministry membership. Someone shown as
// "Community" there can still hold real staff access.
//
// This endpoint strips all of it:
//   * every role except community_member / self_service
//   * every user_permissions grant
//   * every staff_ministry_members row (incl. leader/point-leader rows and the
//     No Ministry placeholder)
//   * users.department and users.job_title
//
// It does NOT touch sign-in. Community members are meant to keep portal
// access, and middleware only checks for a session anyway. Use "Mark inactive"
// or "Delete user" for the harsher cases. Profile, household, enrolments,
// applications, agreements and history are all left alone.
//
// GET  ?user_id=…  → preview of exactly what a POST would remove.
// POST { user_id } → performs the conversion and audit-logs a full snapshot.

const KEEP_ROLES = new Set(["community_member", "self_service"]);

type RoleJoin = { name: string; display_name: string } | { name: string; display_name: string }[];

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Everything the conversion would remove, read through the admin client.
 *
 * `admin` is untyped: staff_ministry_members is missing from the (stale)
 * generated types, so this follows the cast pattern used by the ministries
 * routes.
 */
async function collectRemovals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string
) {
  const [rolesRes, permsRes, ministriesRes, userRes] = await Promise.all([
    admin
      .from("user_roles")
      .select("id, role_id, scope_type, scope_id, roles!inner(name, display_name)")
      .eq("user_id", userId),
    admin
      .from("user_permissions")
      .select("id, permission_id, scope_type, scope_id, permissions!inner(key)")
      .eq("user_id", userId),
    admin
      .from("staff_ministry_members")
      .select(
        "id, staff_ministry_id, member_role, is_point_leader, status, staff_ministries!inner(name, slug)"
      )
      .eq("user_id", userId),
    admin
      .from("users")
      .select("id, department, job_title")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  type RoleRow = {
    id: string;
    role_id: string;
    scope_type: string | null;
    scope_id: string | null;
    roles: RoleJoin;
  };

  const allRoles = (rolesRes.data ?? []) as unknown as RoleRow[];
  const roles = allRoles
    .map((r) => ({
      id: r.id,
      role_id: r.role_id,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      name: unwrap(r.roles)?.name ?? "",
      display_name: unwrap(r.roles)?.display_name ?? "",
    }))
    .filter((r) => r.name && !KEEP_ROLES.has(r.name));

  type PermRow = {
    id: string;
    permission_id: string;
    scope_type: string | null;
    scope_id: string | null;
    permissions: { key: string } | { key: string }[];
  };
  const permissions = ((permsRes.data ?? []) as unknown as PermRow[]).map((p) => ({
    id: p.id,
    permission_id: p.permission_id,
    scope_type: p.scope_type,
    scope_id: p.scope_id,
    key: unwrap(p.permissions)?.key ?? "",
  }));

  type MinRow = {
    id: string;
    staff_ministry_id: string;
    member_role: string;
    is_point_leader: boolean;
    status: string;
    staff_ministries: { name: string; slug: string } | { name: string; slug: string }[];
  };
  const ministries = ((ministriesRes.data ?? []) as unknown as MinRow[]).map((m) => ({
    id: m.id,
    staff_ministry_id: m.staff_ministry_id,
    member_role: m.member_role,
    is_point_leader: m.is_point_leader,
    status: m.status,
    name: unwrap(m.staff_ministries)?.name ?? "",
    slug: unwrap(m.staff_ministries)?.slug ?? "",
  }));

  const target = (userRes.data ?? null) as {
    id: string;
    department: string | null;
    job_title: string | null;
  } | null;

  return {
    roles,
    permissions,
    ministries,
    department: target?.department ?? null,
    job_title: target?.job_title ?? null,
    is_super_admin: roles.some((r) => r.name === "super_admin"),
    /** Already community-only — nothing to strip. */
    nothing_to_do:
      roles.length === 0 &&
      permissions.length === 0 &&
      ministries.length === 0 &&
      !target?.department &&
      !target?.job_title,
  };
}

/** Shared auth + target validation for both verbs. */
async function authorize(userId: string | null) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await callerIsSuperAdmin(supabase, authUser.id))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  if (!userId) {
    return { error: NextResponse.json({ error: "user_id is required" }, { status: 400 }) };
  }
  if (userId === authUser.id) {
    return {
      error: NextResponse.json(
        { error: "You cannot convert your own account." },
        { status: 400 }
      ),
    };
  }
  return { authUser };
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("user_id");
  const auth = await authorize(userId);
  if (auth.error) return auth.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const removals = await collectRemovals(admin, userId!);
  return NextResponse.json({ preview: removals });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { user_id } = body as { user_id?: string };
  const auth = await authorize(user_id ?? null);
  if (auth.error) return auth.error;
  const authUser = auth.authUser!;
  const userId = user_id!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const removals = await collectRemovals(admin, userId);

  // Never leave the org without a super admin.
  if (removals.is_super_admin) {
    const { data: supers } = await admin
      .from("user_roles")
      .select("user_id, roles!inner(name)")
      .eq("roles.name", "super_admin");
    const otherSupers = new Set(
      ((supers ?? []) as { user_id: string }[])
        .map((r) => r.user_id)
        .filter((id) => id !== userId)
    );
    if (otherSupers.size === 0) {
      return NextResponse.json(
        { error: "This is the only super admin — grant super admin to someone else first." },
        { status: 400 }
      );
    }
  }

  // 1. Roles: everything except the community floor.
  if (removals.roles.length > 0) {
    const { error } = await admin
      .from("user_roles")
      .delete()
      .in(
        "id",
        removals.roles.map((r) => r.id)
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. Per-person permission grants.
  if (removals.permissions.length > 0) {
    const { error } = await admin
      .from("user_permissions")
      .delete()
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 3. Grant the community floor. Same upsert shape as set-membership-role.
  const { data: roleRows } = await admin
    .from("roles")
    .select("id, name")
    .in("name", ["community_member", "self_service"]);
  const toGrant = ((roleRows ?? []) as { id: string; name: string }[]).map((r) => ({
    user_id: userId,
    role_id: r.id,
    scope_type: null,
    scope_id: null,
    assigned_by: authUser.id,
  }));
  if (toGrant.length > 0) {
    const { error } = await admin.from("user_roles").upsert(toGrant, {
      onConflict: "user_id,role_id,scope_type,scope_id",
      ignoreDuplicates: true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 4. Ministry rosters — after the role delete, so the migration-206 trigger
  //    no longer sees the `staff` role and does not re-add No Ministry.
  //    Sub-category rows cascade (migration 205).
  if (removals.ministries.length > 0) {
    const { error } = await admin
      .from("staff_ministry_members")
      .delete()
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 5. Staff-only profile fields.
  await admin
    .from("users")
    .update({ department: null, job_title: null })
    .eq("id", userId);

  // 6. Full snapshot, so this is reversible by hand.
  await admin.from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "user_roles",
    resource_id: userId,
    changes: { converted_to_community: removals },
  });

  return NextResponse.json({ success: true, removed: removals });
}
