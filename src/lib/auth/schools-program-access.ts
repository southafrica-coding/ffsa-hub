import { ASSIGNABLE_CONTACT_PERMISSION_KEY } from "@/lib/auth/assignable-contacts";
import { accountIsActive, namesOf, permissionOf } from "@/lib/auth/grant-scope";

// Which schools an active user may see on Training.
//
// 'all'     — unscoped admin / super_admin, or an unscoped schools grant
//             other than schools.assignable_as_contact (direct or via a
//             role bundle). Training home shows every program.
// string[]  — program ids from program-scoped grants of those same keys.
//             Training home shows only these programs.
// []        — no Training access from schools grants. Includes a user whose
//             only schools key is assignable_as_contact, a deactivated
//             account, a team/event scope, and any lookup error.

export type SchoolsProgramAccess = "all" | string[];

type RoleAssignment = {
  role_id: string;
  scope_type?: string | null;
  scope_id?: string | null;
  names: string[];
};

type PermRow = {
  scope_type?: string | null;
  scope_id?: string | null;
  permissions?: { module?: string; key?: string } | { module?: string; key?: string }[] | null;
};

function isTrainingKey(module: string | undefined, key: string | undefined): boolean {
  if (key === ASSIGNABLE_CONTACT_PERMISSION_KEY) return false;
  if (module === "schools") return true;
  return typeof key === "string" && key.startsWith("schools.");
}

function addProgram(ids: Set<string>, scopeId: string | null | undefined) {
  if (typeof scopeId === "string" && scopeId.length > 0) ids.add(scopeId);
}

/** Create Program is an org-wide action. A program-scoped grant is not enough. */
export function canCreateProgram(access: SchoolsProgramAccess): boolean {
  return access === "all";
}

export async function getAccessibleSchoolsProgramIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<SchoolsProgramAccess> {
  const [active, rolesResult, directResult] = await Promise.all([
    accountIsActive(supabase, userId),
    supabase
      .from("user_roles")
      .select("role_id, scope_type, scope_id, roles(name)")
      .eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("scope_type, scope_id, permissions!inner(module, key)")
      .eq("user_id", userId),
  ]);
  if (!active || rolesResult.error || directResult.error) return [];

  const assignments = ((rolesResult.data ?? []) as Array<{
    role_id?: string;
    scope_type?: string | null;
    scope_id?: string | null;
    roles?: { name?: string } | { name?: string }[] | null;
  }>)
    .filter((row): row is typeof row & { role_id: string } => typeof row.role_id === "string")
    .map(
      (row): RoleAssignment => ({
        role_id: row.role_id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        names: namesOf(row.roles),
      })
    );

  const ids = new Set<string>();
  let seesAll = assignments.some(
    (row) =>
      row.scope_type === null &&
      row.names.some((name) => name === "super_admin" || name === "admin")
  );

  for (const row of (directResult.data ?? []) as PermRow[]) {
    const perm = permissionOf(row);
    if (!isTrainingKey(perm?.module, perm?.key)) continue;
    if (row.scope_type === null) seesAll = true;
    else if (row.scope_type === "program") addProgram(ids, row.scope_id);
  }
  if (seesAll) return "all";

  const useful = assignments.filter(
    (row) =>
      row.scope_type === null ||
      (row.scope_type === "program" && typeof row.scope_id === "string" && row.scope_id.length > 0)
  );
  const roleIds = [...new Set(useful.map((row) => row.role_id))];
  if (roleIds.length === 0) return [...ids];

  const bundled = await supabase
    .from("role_permissions")
    .select("role_id, permissions!inner(module, key)")
    .in("role_id", roleIds);
  if (bundled.error) return [];

  for (const row of (bundled.data ?? []) as Array<PermRow & { role_id?: string }>) {
    const perm = permissionOf(row);
    if (!isTrainingKey(perm?.module, perm?.key)) continue;
    for (const assignment of useful) {
      if (assignment.role_id !== row.role_id) continue;
      if (assignment.scope_type === null) return "all";
      if (assignment.scope_type === "program") addProgram(ids, assignment.scope_id);
    }
  }
  return [...ids];
}
