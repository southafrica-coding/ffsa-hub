// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// The signed-in user's own profile, roles and permissions (GET /api/me).
// Always called with the caller's own RLS client and filtered to their id:
// admins can read everyone's rows, so the filter is what keeps this to
// "me". Shaping lives in src/lib/me.ts.
// ────────────────────────────────────────────────────────────

export async function getMyProfileRow(supabase: Client, userId: string) {
  return supabase
    .from("users")
    .select("first_name, last_name, preferred_name, avatar_url, is_active")
    .eq("id", userId)
    .maybeSingle();
}

export async function getMyRoleAssignments(supabase: Client, userId: string) {
  return supabase
    .from("user_roles")
    .select("role_id, scope_type, scope_id, roles(name)")
    .eq("user_id", userId);
}

export async function getMyDirectPermissions(supabase: Client, userId: string) {
  return supabase
    .from("user_permissions")
    .select("scope_type, scope_id, permissions(key)")
    .eq("user_id", userId);
}

// role_permissions is readable by any signed-in user (migration 089).
export async function getRoleBundles(supabase: Client, roleIds: string[]) {
  if (roleIds.length === 0) return { data: [], error: null };
  return supabase
    .from("role_permissions")
    .select("role_id, permissions(key)")
    .in("role_id", roleIds);
}
