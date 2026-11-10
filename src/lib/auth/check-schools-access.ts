import type { SupabaseClient } from "@supabase/supabase-js";
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

/** True only when every program is one this user may manage. */
export async function userCanManageEveryProgram(
  supabase: SupabaseClient,
  userId: string,
  programIds: string[]
): Promise<boolean> {
  if (programIds.length === 0) return false;
  for (const programId of programIds) {
    if (!(await userCanManageApplications(supabase, userId, programId))) return false;
  }
  return true;
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
