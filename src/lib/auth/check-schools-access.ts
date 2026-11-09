import type { SupabaseClient } from "@supabase/supabase-js";

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
