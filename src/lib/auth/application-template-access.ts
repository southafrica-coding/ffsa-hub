// Who may create, rename, or delete school application templates.
//
// Migration 316 limits INSERT/UPDATE/DELETE on application_templates to
// is_admin() or an UNSCOPED schools.manage grant. A program-scoped
// schools.manage grant can still read and apply templates. is_admin()
// (migration 002) is an unscoped super_admin or admin role — a
// program-scoped admin role does not count.
//
// schools.manage is held either as a direct user_permissions row or via
// a role bundle (program_leader's bundle, migration 125). Only an
// unscoped assignment counts, matching has_permission_for's
// scope_type IS NULL branch. The role name itself is not enough.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const SCHOOLS_MANAGE = "schools.manage";

type RoleRow = {
  role_id?: string;
  scope_type?: string | null;
  roles?: { name: string } | { name: string }[] | null;
};

function roleNames(row: RoleRow): string[] {
  const roles = row.roles;
  if (Array.isArray(roles)) return roles.map((r) => r.name).filter((n): n is string => typeof n === "string");
  return roles?.name ? [roles.name] : [];
}

function holdsSchoolsManage(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => {
    const perm = (row as { permissions?: { key?: string } | { key?: string }[] | null }).permissions;
    const list = Array.isArray(perm) ? perm : perm ? [perm] : [];
    return list.some((p) => p?.key === SCHOOLS_MANAGE);
  });
}

/** True only for an unscoped admin (is_admin()) or unscoped schools.manage. */
export async function canManageApplicationTemplates(supabase: Client, userId: string): Promise<boolean> {
  const [{ data: roleRows }, { data: direct }] = await Promise.all([
    supabase.from("user_roles").select("role_id, scope_type, roles(name)").eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("scope_type, permissions!inner(key)")
      .eq("user_id", userId)
      .is("scope_type", null)
      .eq("permissions.key", SCHOOLS_MANAGE)
      .limit(1),
  ]);

  const roles = (Array.isArray(roleRows) ? roleRows : []) as RoleRow[];
  const unscoped = roles.filter((r) => r.scope_type == null);
  const names = unscoped.flatMap(roleNames);
  if (names.includes("super_admin") || names.includes("admin")) return true;

  // A direct row came back only if the query's scope_type IS NULL filter
  // matched. Still require the key, in case the join shape is an array.
  if (holdsSchoolsManage(direct)) return true;

  const roleIds = unscoped.map((r) => r.role_id).filter((id): id is string => typeof id === "string");
  if (roleIds.length === 0) return false;

  const { data: bundled } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .eq("permissions.key", SCHOOLS_MANAGE)
    .limit(1);

  return holdsSchoolsManage(bundled);
}
