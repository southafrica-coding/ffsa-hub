import type { SupabaseClient } from "@supabase/supabase-js";
import { getApplicationExpiry } from "@/lib/auth/application-expiry";

// The schools permission keys that confer management access. Kept in one place
// so the global and program-scoped checks below can never drift apart.
const SCHOOLS_MANAGE_KEYS = [
  "schools.manage",
  "schools.approve_applications",
  "schools.manage_enrollments",
];

// Migration 312, can_manage_program_applications:
//   ur.scope_type IS NULL
//   OR (ur.scope_type = 'program' AND ur.scope_id = target_program_id)
// A team or event scope matches neither side. With no target program, only
// the unscoped row counts — a program-scoped role is not a global manager.
function programLeaderRoleCounts(
  scopeType: string | null,
  scopeId: string | null,
  programId: string | null
): boolean {
  // SQL `scope_type IS NULL` only. A missing column is not an unscoped grant.
  if (scopeType === null) return true;
  return programId != null && scopeType === "program" && scopeId === programId;
}

function embeddedName(
  value: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? null;
}

/**
 * Admin / super_admin (any scope — unchanged) or a program_leader role that
 * migration 312 would accept for `programId`. No `.limit(1)`: a team-scoped
 * program_leader row must not hide an unscoped role or an admin row.
 */
async function hasManagingRole(
  supabase: SupabaseClient,
  userId: string,
  programId: string | null
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("scope_type, scope_id, roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin", "program_leader"]);

  for (const row of data ?? []) {
    const name = embeddedName(row.roles);
    if (name === "super_admin" || name === "admin") return true;
    if (
      name === "program_leader" &&
      programLeaderRoleCounts(row.scope_type, row.scope_id, programId)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the user may manage schools applications.
 *
 * With no `programId` this is the global check. It counts:
 *   admin/super_admin, an unscoped program_leader role (scope_type IS NULL),
 *   or an unscoped `schools.*` management permission.
 * A program-scoped program_leader does not pass. A `schools.*` grant scoped
 * to one program does not pass either — that stays on `userCanManageProgram`.
 *
 * With `programId`, the same global sources count, plus a program_leader
 * role scoped to that program (312). Team- and event-scoped roles still
 * count for nothing. program_leaders rows are not consulted here.
 */
export async function userCanManageApplications(
  supabase: SupabaseClient,
  userId: string,
  programId?: string | null
): Promise<boolean> {
  if (await hasManagingRole(supabase, userId, programId || null)) return true;

  // Check schools-related permissions — GLOBAL grants only (scope_type IS NULL).
  const { data: perms } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .is("scope_type", null)
    .in("permissions.key", SCHOOLS_MANAGE_KEYS)
    .limit(1);

  return !!perms && perms.length > 0;
}

/**
 * Program-scoped variant: can this user manage THIS specific program?
 * True for global schools managers/admins (see above), for a program_leader
 * role scoped to this program (312), for a `schools.*` grant scoped to this
 * program, and for anyone named a leader of the program (program_leaders,
 * migration 145).
 */
export async function userCanManageProgram(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  if (await userCanManageApplications(supabase, userId, programId)) return true;

  // A schools.* permission scoped specifically to this program.
  const { data: scopedPerms } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .eq("scope_type", "program")
    .eq("scope_id", programId)
    .in("permissions.key", SCHOOLS_MANAGE_KEYS)
    .limit(1);

  if (scopedPerms && scopedPerms.length > 0) return true;

  const { data } = await supabase
    .from("program_leaders")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .limit(1);

  return !!data && data.length > 0;
}

// DELETE on application_responses (migration 223, unchanged by 312):
//   application_gate(program_id,
//     has_schools_access() OR has_permission('schools.approve_applications'))
// has_schools_access() with no argument is is_admin() OR
// has_permission('schools.manage'). is_admin() counts only an unscoped
// admin or super_admin. has_permission(key) ignores scope: any direct
// grant, and any role whose bundle includes the key.
const DELETE_PERMISSION_KEYS = ["schools.manage", "schools.approve_applications"] as const;

function permissionKey(
  value: { key: string } | { key: string }[] | null | undefined
): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.key ?? null;
}

function isDeletePermission(key: string | null): boolean {
  return key === "schools.manage" || key === "schools.approve_applications";
}

/** is_admin(): super_admin or admin with scope_type IS NULL. */
async function hasUnscopedAdminRole(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("scope_type, roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"]);

  for (const row of data ?? []) {
    const name = embeddedName(row.roles);
    if ((name === "super_admin" || name === "admin") && row.scope_type === null) return true;
  }
  return false;
}

/**
 * has_permission(key) for the two DELETE keys. Scope is not consulted.
 * A direct row of any scope_type counts, as does a role bundle on any
 * user_roles row (a team-scoped program_leader still carries schools.manage).
 */
async function hasDeletePermissionIgnoringScope(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: direct } = await supabase
    .from("user_permissions")
    .select("scope_type, permissions!inner(key)")
    .eq("user_id", userId)
    .in("permissions.key", [...DELETE_PERMISSION_KEYS]);

  for (const row of direct ?? []) {
    if (isDeletePermission(permissionKey(row.permissions))) return true;
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);
  const roleIds = (roles ?? [])
    .map((row) => row.role_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (roleIds.length === 0) return false;

  const { data: bundle } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", [...DELETE_PERMISSION_KEYS]);

  for (const row of bundle ?? []) {
    if (isDeletePermission(permissionKey(row.permissions))) return true;
  }
  return false;
}

/**
 * May this user permanently delete an application in this program?
 * Mirrors migration 223's DELETE policy, including the expiry gate.
 * A program_leaders row does not qualify. schools.manage_enrollments
 * does not qualify. When the school's applications are expired, only
 * can_access_expired_applications() (unscoped super_admin or the
 * Training Team) passes.
 */
export async function userCanDeleteApplication(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  let expiry;
  try {
    expiry = await getApplicationExpiry(supabase, programId);
  } catch {
    return false;
  }
  // An RPC error is not "the school is still open".
  if (expiry.lookupFailed) return false;
  if (expiry.expired) return expiry.canAccess;

  if (await hasUnscopedAdminRole(supabase, userId)) return true;
  return hasDeletePermissionIgnoringScope(supabase, userId);
}
