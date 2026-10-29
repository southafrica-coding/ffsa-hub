// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type Permission = {
  id: string;
  module: string;
  key: string;
  display_name: string;
  sort_order: number;
};

export type UserPermission = {
  id: string;
  user_id: string;
  permission_id: string;
  scope_type: string | null;
  scope_id: string | null;
  granted_at: string;
  granted_by: string | null;
  permissions: Permission;
};

export type PermissionsByModule = Record<string, Permission[]>;

export type ScopeOption = {
  id: string;
  label: string;
  scope_type: "program" | "team" | "event";
};

/** All permissions grouped by module */
export async function getPermissions(supabase: Client): Promise<PermissionsByModule> {
  const { data, error } = await supabase
    .from("permissions")
    .select("*")
    .order("module")
    .order("sort_order");

  if (error || !data) return {};

  return (data as Permission[]).reduce<PermissionsByModule>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});
}

/** All permissions granted to a specific user */
export async function getUserPermissions(
  supabase: Client,
  userId: string
): Promise<UserPermission[]> {
  const { data } = await supabase
    .from("user_permissions")
    .select("*, permissions(*)")
    .eq("user_id", userId);

  return data ?? [];
}

/** Grant a permission to a user (super_admin only enforced by RLS) */
export async function grantPermission(
  supabase: Client,
  userId: string,
  permissionId: string,
  grantedBy: string,
  scopeType?: string,
  scopeId?: string
) {
  return supabase.from("user_permissions").upsert(
    {
      user_id: userId,
      permission_id: permissionId,
      scope_type: scopeType ?? null,
      scope_id: scopeId ?? null,
      granted_by: grantedBy,
    },
    { onConflict: "user_id,permission_id,scope_type,scope_id" }
  );
}

/** Revoke a permission from a user */
export async function revokePermission(
  supabase: Client,
  userId: string,
  permissionId: string,
  scopeType?: string,
  scopeId?: string
) {
  let query = supabase
    .from("user_permissions")
    .delete()
    .eq("user_id", userId)
    .eq("permission_id", permissionId);

  if (scopeType && scopeId) {
    query = query.eq("scope_type", scopeType).eq("scope_id", scopeId);
  } else {
    query = query.is("scope_type", null).is("scope_id", null);
  }

  return query;
}

/** Existing programs, teams, events to use as scope options in the permission UI */
export async function getScopeOptions(supabase: Client): Promise<ScopeOption[]> {
  const [programs, teams, events] = await Promise.all([
    supabase.from("programs").select("id, name").order("name"),
    supabase.from("outreach_teams").select("id, name").order("name"),
    supabase
      .from("events")
      .select("id, title")
      .eq("status", "published")
      .order("start_date", { ascending: false })
      .limit(20),
  ]);

  const options: ScopeOption[] = [];

  for (const p of programs.data ?? []) {
    options.push({ id: p.id, label: p.name, scope_type: "program" });
  }
  for (const t of teams.data ?? []) {
    options.push({ id: t.id, label: t.name, scope_type: "team" });
  }
  for (const e of events.data ?? []) {
    options.push({ id: e.id, label: e.title, scope_type: "event" });
  }

  return options;
}

/**
 * Returns the set of module ids a user can access based on their permissions.
 * super_admin and admin bypass this — they see everything.
 */
export function getPermittedModules(userPermissions: UserPermission[]): Set<string> {
  return new Set(userPermissions.map((up) => up.permissions.module));
}

/**
 * {module, key} pairs a user receives via the bundles of the roles
 * assigned to them (user_roles -> role_permissions -> permissions).
 * Mirrors the shape of direct user_permissions so callers can treat
 * role-derived and direct access identically.
 */
export async function getRoleDerivedPermissionRows(
  supabase: Client,
  userId: string
): Promise<{ module: string; key: string }[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id);
  return getPermissionRowsForRoles(supabase, roleIds);
}

/**
 * Same as getRoleDerivedPermissionRows, for callers that already hold the
 * user's role ids (saves re-reading user_roles).
 */
export async function getPermissionRowsForRoles(
  supabase: Client,
  roleIds: string[]
): Promise<{ module: string; key: string }[]> {
  if (roleIds.length === 0) return [];

  const { data: permRows } = await supabase
    .from("role_permissions")
    .select("permissions!inner(module, key)")
    .in("role_id", roleIds);

  const rows: { module: string; key: string }[] = [];
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    if (perm?.module) rows.push({ module: perm.module, key: perm.key });
  }
  return rows;
}

/**
 * Capability keys hidden from the role builder + the granular grid because
 * they're legacy duplicates of a canonical key. Keep-and-honor kept every key
 * for RLS, but the UI shouldn't show two of the same thing.
 */
export const HIDDEN_PERMISSION_KEYS = new Set<string>([
  "contacts.view", // → contacts.read  ("View contacts")
  "contacts.create", // → contacts.write ("Create / edit contacts")
  "contacts.edit", // → contacts.write
  "contacts.delete", // → contacts.write
]);

/** Drop hidden / legacy-duplicate permissions from a by-module catalog. */
export function curatePermissions(byModule: PermissionsByModule): PermissionsByModule {
  const out: PermissionsByModule = {};
  for (const mod of Object.keys(byModule)) {
    const kept = byModule[mod].filter((p) => !HIDDEN_PERMISSION_KEYS.has(p.key));
    if (kept.length > 0) out[mod] = kept;
  }
  return out;
}
