import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true if the user has access to manage school applications.
 *
 * Mirrors the database `has_schools_access()` helper used by RLS policies:
 *   admin/super_admin role, OR program_leader role, OR `schools.manage` /
 *   `schools.approve_applications` permission.
 */
export async function userCanManageApplications(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  // Check roles
  const { data: roles } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin", "program_leader"])
    .limit(1);

  if (roles && roles.length > 0) return true;

  // Check schools-related permissions
  const { data: perms } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .in("permissions.key", [
      "schools.manage",
      "schools.approve_applications",
      "schools.manage_enrollments",
    ])
    .limit(1);

  return !!perms && perms.length > 0;
}

/**
 * Program-scoped variant: can this user manage THIS specific program?
 * True for global schools managers/admins, and for anyone named a leader
 * of the program (program_leaders, migration 145). Mirrors the DB
 * has_schools_access(program_id) check for the app layer.
 */
export async function userCanManageProgram(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  if (await userCanManageApplications(supabase, userId)) return true;

  const { data } = await supabase
    .from("program_leaders")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .limit(1);

  return !!data && data.length > 0;
}
