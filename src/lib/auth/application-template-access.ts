// Who may create or delete school application templates.
//
// Migration 316 limits INSERT/UPDATE/DELETE to an active user who is an
// unscoped admin (is_admin(): super_admin or admin with scope_type null)
// or who holds an UNSCOPED schools.manage or schools.templates.manage
// grant. A program-scoped grant can still read and apply templates.
// is_active = false is inactive. NULL is_active counts as active.
//
// A grant is unscoped when scope_type is null, either on the direct
// user_permissions row or on the user_roles assignment whose bundle
// includes the key (program_leader carries schools.manage that way,
// migration 125). The role name itself is not enough. The templates
// key may not be seeded yet; this only checks the key string.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const TEMPLATE_MANAGE_KEYS = ["schools.manage", "schools.templates.manage"];

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

function holdsTemplateManage(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => {
    const perm = (row as { permissions?: { key?: string } | { key?: string }[] | null }).permissions;
    const list = Array.isArray(perm) ? perm : perm ? [perm] : [];
    return list.some((p) => !!p?.key && TEMPLATE_MANAGE_KEYS.includes(p.key));
  });
}

/** NULL is_active counts as active. A missing row or a read error does not. */
function accountIsActive(data: unknown): boolean {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return false;
  return (row as { is_active?: boolean | null }).is_active !== false;
}

/** True only for an active unscoped admin, or unscoped schools.manage / schools.templates.manage. */
export async function canManageApplicationTemplates(supabase: Client, userId: string): Promise<boolean> {
  const [{ data: account, error: accountError }, { data: roleRows }, { data: direct }] = await Promise.all([
    supabase.from("users").select("is_active").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role_id, scope_type, roles(name)").eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("scope_type, permissions!inner(key)")
      .eq("user_id", userId)
      .is("scope_type", null)
      .in("permissions.key", TEMPLATE_MANAGE_KEYS)
      .limit(1),
  ]);

  if (accountError || !accountIsActive(account)) return false;

  const roles = (Array.isArray(roleRows) ? roleRows : []) as RoleRow[];
  const unscoped = roles.filter((r) => r.scope_type == null);
  const names = unscoped.flatMap(roleNames);
  if (names.includes("super_admin") || names.includes("admin")) return true;

  // A direct row came back only if the query's scope_type IS NULL filter
  // matched. Still require one of the two keys, in case the join is an array.
  if (holdsTemplateManage(direct)) return true;

  const roleIds = unscoped.map((r) => r.role_id).filter((id): id is string => typeof id === "string");
  if (roleIds.length === 0) return false;

  const { data: bundled } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", TEMPLATE_MANAGE_KEYS)
    .limit(1);

  return holdsTemplateManage(bundled);
}
