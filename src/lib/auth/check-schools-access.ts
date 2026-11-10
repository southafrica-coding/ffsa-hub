import type { SupabaseClient } from "@supabase/supabase-js";
import { getApplicationExpiry } from "@/lib/auth/application-expiry";
import { accountIsActive } from "@/lib/auth/grant-scope";

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
 * A failed read is not a grant.
 */
async function hasManagingRole(
  supabase: SupabaseClient,
  userId: string,
  programId: string | null
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("scope_type, scope_id, roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin", "program_leader"]);
  if (error) return false;

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
 *
 * users.is_active false, a missing account, and any lookup error are false.
 * NULL is_active stays active.
 */
export async function userCanManageApplications(
  supabase: SupabaseClient,
  userId: string,
  programId?: string | null
): Promise<boolean> {
  if (!(await accountIsActive(supabase, userId))) return false;
  if (await hasManagingRole(supabase, userId, programId || null)) return true;

  // Check schools-related permissions — GLOBAL grants only (scope_type IS NULL).
  const { data: perms, error: permsError } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .is("scope_type", null)
    .in("permissions.key", SCHOOLS_MANAGE_KEYS)
    .limit(1);
  if (permsError) return false;

  return !!perms && perms.length > 0;
}

/**
 * Program-scoped variant: can this user manage THIS specific program?
 * True for global schools managers/admins (see above), for a `schools.*`
 * grant scoped to this program, and for anyone named a leader of the program
 * (program_leaders, migration 145). Mirrors the DB
 * has_schools_access(program_id) check for the app layer.
 */
export async function userCanManageProgram(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  if (!(await accountIsActive(supabase, userId))) return false;
  if (await userCanManageApplications(supabase, userId, programId)) return true;

  // A schools.* permission scoped specifically to this program.
  const { data: scopedPerms, error: scopedError } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .eq("scope_type", "program")
    .eq("scope_id", programId)
    .in("permissions.key", SCHOOLS_MANAGE_KEYS)
    .limit(1);
  if (scopedError) return false;

  if (scopedPerms && scopedPerms.length > 0) return true;

  const { data, error } = await supabase
    .from("program_leaders")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .limit(1);
  if (error) return false;

  return !!data && data.length > 0;
}

// DELETE on application_responses (migration 313). Same shape as #540 so a
// later merge keeps one copy: unscoped admin, or schools.manage /
// schools.approve_applications unscoped or program-scoped to this program.
// A program_leaders row does not qualify. schools.manage_enrollments does not.
// Team and event scopes do not. When the school's applications are expired,
// only can_access_expired_applications passes.
const DELETE_PERMISSION_KEYS = ["schools.manage", "schools.approve_applications"] as const;

function scopeCoversProgram(
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
  programId: string
): boolean {
  if (scopeType === null) return true;
  return scopeType === "program" && scopeId === programId;
}

function permissionKey(
  value: { key: string } | { key: string }[] | null | undefined
): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.key ?? null;
}

function isManageKey(key: string | null): boolean {
  return key != null && (SCHOOLS_MANAGE_KEYS as readonly string[]).includes(key);
}

function isDeletePermission(key: string | null): boolean {
  return key === "schools.manage" || key === "schools.approve_applications";
}

/** is_admin(): super_admin or admin with scope_type IS NULL. */
async function hasUnscopedAdminRole(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("scope_type, roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"]);
  if (error) return false;

  for (const row of data ?? []) {
    const name = embeddedName(row.roles);
    if ((name === "super_admin" || name === "admin") && row.scope_type === null) return true;
  }
  return false;
}

/**
 * has_permission_for for the two DELETE keys. Scope is the grant's or the
 * role assignment's: null is global, program must match, team and event do not.
 */
async function hasDeletePermissionForProgram(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  if (!(await accountIsActive(supabase, userId))) return false;

  const direct = await supabase
    .from("user_permissions")
    .select("scope_type, scope_id, permissions!inner(key)")
    .eq("user_id", userId)
    .in("permissions.key", [...DELETE_PERMISSION_KEYS]);
  if (direct.error) return false;

  for (const row of direct.data ?? []) {
    if (!isDeletePermission(permissionKey(row.permissions))) continue;
    if (scopeCoversProgram(row.scope_type, row.scope_id, programId)) return true;
  }

  const roles = await supabase
    .from("user_roles")
    .select("role_id, scope_type, scope_id")
    .eq("user_id", userId);
  if (roles.error) return false;
  const roleIds = (roles.data ?? [])
    .filter((row) => scopeCoversProgram(row.scope_type, row.scope_id, programId))
    .map((row) => row.role_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (roleIds.length === 0) return false;

  const bundle = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", [...DELETE_PERMISSION_KEYS]);
  if (bundle.error) return false;

  for (const row of bundle.data ?? []) {
    if (isDeletePermission(permissionKey(row.permissions))) return true;
  }
  return false;
}

/**
 * May this user permanently delete an application in this program?
 * Sits on top of userCanManageProgram. #540 owns the expiry lookupFailed
 * detail; until that lands, a thrown expiry read denies and an expired
 * school without can_access_expired_applications denies.
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
  if (expiry.expired && !expiry.canAccess) return false;

  if (await hasUnscopedAdminRole(supabase, userId)) return true;
  return hasDeletePermissionForProgram(supabase, userId, programId);
}

/** True only when every program passes userCanManageProgram. */
export async function userCanManageEveryProgram(
  supabase: SupabaseClient,
  userId: string,
  programIds: string[]
): Promise<boolean> {
  if (programIds.length === 0) return false;
  for (const programId of programIds) {
    if (!(await userCanManageProgram(supabase, userId, programId))) return false;
  }
  return true;
}

/**
 * Programs this user may manage, for a list that has no program id of its own.
 * `{ all: true }` is an unscoped manager (userCanManageApplications with no
 * program). Otherwise only programs where userCanManageProgram is true:
 * a program-scoped schools.manage / approve_applications / manage_enrollments
 * grant, a program_leader role scoped to that program, or a program_leaders
 * row. A schools key outside that set does not qualify. Null is a lookup error.
 */
export async function manageablePrograms(
  supabase: SupabaseClient,
  userId: string
): Promise<{ all: true } | { all: false; ids: string[] } | null> {
  if (!(await accountIsActive(supabase, userId))) return { all: false, ids: [] };
  if (await userCanManageApplications(supabase, userId)) return { all: true };

  const [roles, perms, leaders] = await Promise.all([
    supabase
      .from("user_roles")
      .select("scope_type, scope_id, roles!inner(name)")
      .eq("user_id", userId)
      .eq("roles.name", "program_leader"),
    supabase
      .from("user_permissions")
      .select("scope_type, scope_id, permissions!inner(key)")
      .eq("user_id", userId)
      .eq("scope_type", "program")
      .in("permissions.key", [...SCHOOLS_MANAGE_KEYS]),
    supabase.from("program_leaders").select("program_id").eq("user_id", userId),
  ]);
  if (roles.error || perms.error || leaders.error) return null;

  const ids = new Set<string>();
  for (const row of roles.data ?? []) {
    if (row.scope_type === "program" && typeof row.scope_id === "string" && row.scope_id.length > 0) {
      ids.add(row.scope_id);
    }
  }
  for (const row of perms.data ?? []) {
    const key = permissionKey(row.permissions);
    if (!isManageKey(key)) continue;
    if (row.scope_type === "program" && typeof row.scope_id === "string" && row.scope_id.length > 0) {
      ids.add(row.scope_id);
    }
  }
  for (const row of leaders.data ?? []) {
    if (typeof row.program_id === "string" && row.program_id.length > 0) ids.add(row.program_id);
  }

  const confirmed: string[] = [];
  for (const programId of ids) {
    if (await userCanManageProgram(supabase, userId, programId)) confirmed.push(programId);
  }
  return { all: false, ids: confirmed };
}

/**
 * program_id for each id. Null when the read errors or any id is missing,
 * so a caller can refuse the whole batch.
 */
export async function programIdsForTargets(
  supabase: SupabaseClient,
  table: "enrollments" | "application_responses",
  ids: string[]
): Promise<string[] | null> {
  if (ids.length === 0) return null;
  const { data, error } = await supabase.from(table).select("id, program_id").in("id", ids);
  if (error || !Array.isArray(data) || data.length !== ids.length) return null;
  const programs: string[] = [];
  for (const row of data as Array<{ program_id?: string | null }>) {
    if (typeof row.program_id !== "string" || row.program_id.length === 0) return null;
    programs.push(row.program_id);
  }
  return programs;
}
