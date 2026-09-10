// Authorization helpers for managing roles (job titles) and assigning them.
//
// Model:
//   - super_admin can do anything.
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
 * Roles that only a super_admin may grant or revoke.
 *
 * `admin` (General Admin) belongs here for two reasons: it carries
 * super-admin-equivalent access through the hardcoded is_admin() bypass, and
 * it has NO role_permissions rows — so the "can only grant what you hold"
 * guardrail below would see an empty key list and pass vacuously, letting any
 * administration.manage_roles holder mint a full admin.
 */
export const SUPER_ADMIN_ONLY_ROLES = ["super_admin", "admin"];

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
  if (await callerIsSuperAdmin(supabase, userId)) return true;
  const keys = await getEffectivePermissionKeys(supabase, userId);
  return keys.has("administration.manage_roles");
}

/**
 * Can the caller create/assign a role carrying exactly `permissionKeys`?
 * super_admin: always. manage_roles holder: only if every key is one they hold.
 */
export async function callerCanGrantPermissionKeys(
  supabase: Client,
  userId: string,
  permissionKeys: string[]
): Promise<boolean> {
  if (await callerIsSuperAdmin(supabase, userId)) return true;
  const held = await getEffectivePermissionKeys(supabase, userId);
  if (!held.has("administration.manage_roles")) return false;
  return permissionKeys.every((k) => held.has(k));
}
