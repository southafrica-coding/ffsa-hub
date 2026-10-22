// Authorization helpers for managing roles (job titles) and assigning them.
//
// Model:
//   - super_admin can do anything.
//   - admin (General Admin) can do everything a super_admin can EXCEPT the
//     Records Library: it cannot hand out super_admin or
//     records_library.manage (either would open the library).
//   - A holder of `administration.manage_roles` can create/edit/assign roles,
//     BUT only ones whose capabilities are a subset of what they themselves
//     hold ("can only grant what you hold") — prevents privilege escalation.

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type KeyRow = { permissions: { key: string } | { key: string }[] };

function keyOf(row: KeyRow): string | undefined {
  return Array.isArray(row.permissions) ? row.permissions[0]?.key : row.permissions?.key;
}

/**
 * Roles that only a super_admin may grant or revoke. super_admin is the one
 * role that opens the Records Library, so a General Admin can't mint it.
 */
export const SUPER_ADMIN_ONLY_ROLES = ["super_admin"];

/**
 * Top-tier roles that a plain administration.manage_roles holder may never
 * grant or revoke. `admin` has NO role_permissions rows, so the "can only
 * grant what you hold" guardrail would pass vacuously for it — only
 * super_admin/admin callers may hand it out.
 */
export const ADMIN_TIER_ROLES = ["super_admin", "admin"];

/**
 * Permission keys only a super_admin may grant (directly or inside a role
 * bundle). Mirrors SUPER_ADMIN_ONLY_MODULES in src/config/modules.ts.
 */
export const SUPER_ADMIN_ONLY_PERMISSION_KEYS = new Set(["records_library.manage"]);

export async function callerIsSuperAdmin(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "super_admin")
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** super_admin OR admin (General Admin). */
export async function callerIsAdmin(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Direct + role-derived permission keys the user effectively holds. */
export async function getEffectivePermissionKeys(
  supabase: Client,
  userId: string
): Promise<Set<string>> {
  const keys = new Set<string>();

  const { data: direct } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId);
  for (const row of (direct ?? []) as KeyRow[]) {
    const k = keyOf(row);
    if (k) keys.add(k);
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);
  const roleIds = ((roleRows ?? []) as { role_id: string }[]).map((r) => r.role_id);
  if (roleIds.length > 0) {
    const { data: rp } = await supabase
      .from("role_permissions")
      .select("permissions!inner(key)")
      .in("role_id", roleIds);
    for (const row of (rp ?? []) as KeyRow[]) {
      const k = keyOf(row);
      if (k) keys.add(k);
    }
  }
  return keys;
}

export async function callerCanManageRoles(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await callerIsAdmin(supabase, userId)) return true;
  const keys = await getEffectivePermissionKeys(supabase, userId);
  return keys.has("administration.manage_roles");
}

/**
 * Can the caller create/assign a role carrying exactly `permissionKeys`?
 * super_admin: always. admin: anything except the super-admin-only keys.
 * manage_roles holder: only if every key is one they hold.
 */
export async function callerCanGrantPermissionKeys(
  supabase: Client,
  userId: string,
  permissionKeys: string[]
): Promise<boolean> {
  if (await callerIsSuperAdmin(supabase, userId)) return true;
  if (await callerIsAdmin(supabase, userId)) {
    return !permissionKeys.some((k) => SUPER_ADMIN_ONLY_PERMISSION_KEYS.has(k));
  }
  const held = await getEffectivePermissionKeys(supabase, userId);
  if (!held.has("administration.manage_roles")) return false;
  return permissionKeys.every((k) => held.has(k));
}
