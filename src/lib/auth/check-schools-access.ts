import type { SupabaseClient } from "@supabase/supabase-js";
import { accountIsActive } from "@/lib/auth/grant-scope";

// The schools permission keys that confer management access. Kept in one place
// so the global and program-scoped checks below can never drift apart.
const SCHOOLS_MANAGE_KEYS = [
  "schools.manage",
  "schools.approve_applications",
  "schools.manage_enrollments",
];

/**
 * Returns true if the user has GLOBAL (all-programs) access to manage schools:
 *   admin/super_admin role, OR program_leader role, OR an *unscoped*
 *   `schools.*` management permission.
 *
 * IMPORTANT: a `schools.*` grant that is scoped to a single program
 * (scope_type = 'program') does NOT count here. Program-scoped grants must be
 * checked against a specific program via `userCanManageProgram` — otherwise a
 * one-school grant would leak into every school. This mirrors the scope-aware
 * DB helper `has_permission_for(key, program_id)` (migration 040).
 */
export async function userCanManageApplications(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  if (!(await accountIsActive(supabase, userId))) return false;

  // Check roles. A failed read is not a grant.
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin", "program_leader"])
    .limit(1);
  if (rolesError) return false;

  if (roles && roles.length > 0) return true;

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
  if (await userCanManageApplications(supabase, userId)) return true;

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
