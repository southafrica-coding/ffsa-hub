import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";

// Converts a person to a community member — the "they've left staff" action.
//
// This is deliberately NOT what the Role dropdown on /users does. That control
// (/api/admin/set-membership-role) only swaps the membership role and leaves
// every actual grant of access in place: job titles, super_admin, per-person
// permission grants, and staff ministry membership. Someone shown as
// "Community" there can still hold real staff access.
//
// The conversion is ITEMISED, not all-or-nothing: community members do serve
// in ministries, so the caller chooses what survives. Anything not explicitly
// kept is removed. The default in the UI is "remove everything", but each
// role, permission grant, ministry membership, the department and the job
// title can be kept individually.
//
// It does NOT touch sign-in. Community members are meant to keep portal
// access, and middleware only checks for a session anyway. Use "Mark inactive"
// or "Delete user" for the harsher cases. Profile, household, enrolments,
// applications, agreements and history are all left alone.
//
// GET  ?user_id=…  → everything that COULD be removed, for the picker.
// POST { user_id, keep } → removes everything not in `keep`, audit-logging
//                          both sides of the decision.

/** Always kept — this is what being a community member means. */
const KEEP_ROLES = new Set(["community_member", "self_service"]);

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Everything the conversion COULD remove, read through the admin client.
 *
 * `admin` is untyped: staff_ministry_members is missing from the (stale)
 * generated types, so this follows the cast pattern used by the ministries
 * routes.
 */
async function collectRemovable(
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
      .select(
        "id, permission_id, scope_type, scope_id, permissions!inner(key, display_name, module)"
      )
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

  type NameRow = { name: string; display_name: string };
  type RoleRow = {
    id: string;
    role_id: string;
    scope_type: string | null;
    scope_id: string | null;
    roles: NameRow | NameRow[];
  };

  const roles = ((rolesRes.data ?? []) as unknown as RoleRow[])
    .map((r) => ({
      id: r.id,
      role_id: r.role_id,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      name: unwrap(r.roles)?.name ?? "",
      display_name: unwrap(r.roles)?.display_name ?? "",
    }))
    .filter((r) => r.name && !KEEP_ROLES.has(r.name));

  type PermJoin = { key: string; display_name: string; module: string };
  type PermRow = {
    id: string;
    permission_id: string;
    scope_type: string | null;
    scope_id: string | null;
    permissions: PermJoin | PermJoin[];
  };
  const permissions = ((permsRes.data ?? []) as unknown as PermRow[]).map((p) => ({
    id: p.id,
    permission_id: p.permission_id,
    scope_type: p.scope_type,
    scope_id: p.scope_id,
    key: unwrap(p.permissions)?.key ?? "",
    display_name: unwrap(p.permissions)?.display_name ?? "",
    module: unwrap(p.permissions)?.module ?? "",
  }));

  type MinJoin = { name: string; slug: string };
  type MinRow = {
    id: string;
    staff_ministry_id: string;
    member_role: string;
    is_point_leader: boolean;
    status: string;
    staff_ministries: MinJoin | MinJoin[];
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
    /** Nothing beyond the community floor — already converted. */
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
  const removable = await collectRemovable(admin, userId!);
  return NextResponse.json({ removable });
}

type KeepInput = {
  role_ids?: string[];
  permission_ids?: string[];
  membership_ids?: string[];
  department?: boolean;
  job_title?: boolean;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { user_id, keep } = body as { user_id?: string; keep?: KeepInput };
  const auth = await authorize(user_id ?? null);
  if (auth.error) return auth.error;
  const authUser = auth.authUser!;
  const userId = user_id!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const removable = await collectRemovable(admin, userId);

  // The client only says what to KEEP. What exists is re-read here, so a stale
  // or hostile payload can never remove something the caller never saw.
  const keepRoles = new Set(keep?.role_ids ?? []);
  const keepPerms = new Set(keep?.permission_ids ?? []);
  const keepMinistries = new Set(keep?.membership_ids ?? []);

  const removeRoles = removable.roles.filter((r) => !keepRoles.has(r.id));
  const removePerms = removable.permissions.filter((p) => !keepPerms.has(p.id));
  const removeMinistries = removable.ministries.filter(
    (m) => !keepMinistries.has(m.id)
  );
  const clearDepartment = !!removable.department && keep?.department !== true;
  const clearJobTitle = !!removable.job_title && keep?.job_title !== true;

  // Never leave the org without a super admin — only relevant if we are
  // actually taking super_admin away.
  if (removeRoles.some((r) => r.name === "super_admin")) {
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

  // 1. Grant the community floor FIRST. None of the deletions below are
  //    transactional, so if this fails it must fail before anything has been
  //    stripped — otherwise a failure here leaves a half-converted account
  //    with no roles at all. Only inserts what's missing: self_service is
  //    normally kept, and re-inserting it would duplicate the row (NULL scope
  //    columns never match a conflict target — see migration 209).
  const { data: floorRoleRows } = await admin
    .from("roles")
    .select("id, name")
    .in("name", ["community_member", "self_service"]);
  const { data: heldRows } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId)
    .is("scope_type", null)
    .is("scope_id", null);
  const held = new Set(
    ((heldRows ?? []) as { role_id: string }[]).map((r) => r.role_id)
  );
  const toGrant = ((floorRoleRows ?? []) as { id: string; name: string }[])
    .filter((r) => !held.has(r.id))
    .map((r) => ({
      user_id: userId,
      role_id: r.id,
      scope_type: null,
      scope_id: null,
      assigned_by: authUser.id,
    }));
  if (toGrant.length > 0) {
    const { error } = await admin.from("user_roles").insert(toGrant);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. Roles.
  if (removeRoles.length > 0) {
    const { error } = await admin
      .from("user_roles")
      .delete()
      .in(
        "id",
        removeRoles.map((r) => r.id)
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 3. Per-person permission grants.
  if (removePerms.length > 0) {
    const { error } = await admin
      .from("user_permissions")
      .delete()
      .in(
        "id",
        removePerms.map((p) => p.id)
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 4. Ministry rosters — after the role delete, so the migration-206 trigger
  //    no longer sees the `staff` role and does not re-add the No Ministry
  //    placeholder to someone who is no longer staff. Sub-category rows
  //    cascade (migration 205). A kept membership is left exactly as it is,
  //    leader flag included: serving in a ministry is not a staff-only thing.
  if (removeMinistries.length > 0) {
    const { error } = await admin
      .from("staff_ministry_members")
      .delete()
      .in(
        "id",
        removeMinistries.map((m) => m.id)
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 5. Staff-only profile fields. Department is the ministry slug shown in the
  //    Users list, so it is kept or cleared as its own decision — someone who
  //    keeps a ministry usually wants to keep showing under it.
  const patch: Record<string, null> = {};
  if (clearDepartment) patch.department = null;
  if (clearJobTitle) patch.job_title = null;
  if (Object.keys(patch).length > 0) {
    await admin.from("users").update(patch).eq("id", userId);
  }

  // 6. Both sides of the decision, so this is reversible by hand and it is
  //    clear what was deliberately left in place.
  const summary = {
    removed: {
      roles: removeRoles,
      permissions: removePerms,
      ministries: removeMinistries,
      department: clearDepartment ? removable.department : null,
      job_title: clearJobTitle ? removable.job_title : null,
    },
    kept: {
      roles: removable.roles.filter((r) => keepRoles.has(r.id)),
      permissions: removable.permissions.filter((p) => keepPerms.has(p.id)),
      ministries: removable.ministries.filter((m) => keepMinistries.has(m.id)),
      department: clearDepartment ? null : removable.department,
      job_title: clearJobTitle ? null : removable.job_title,
    },
  };

  await admin.from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "user_roles",
    resource_id: userId,
    changes: { converted_to_community: summary },
  });

  return NextResponse.json({ success: true, ...summary });
}
