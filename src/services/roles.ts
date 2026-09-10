import type { Database, TablesInsert } from "@/types/database";
import { getAuthSignIns } from "@/lib/users/auth-signins";
type UserRoleInsert = TablesInsert<"user_roles">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getRoles(supabase: Client) {
  return supabase.from("roles").select("*").order("name");
}

export async function getRoleByName(supabase: Client, name: string) {
  return supabase.from("roles").select("*").eq("name", name).single();
}

export async function getUserRoles(supabase: Client, userId: string) {
  return supabase
    .from("user_roles")
    .select("*, roles(*)")
    .eq("user_id", userId);
}

export async function assignRole(supabase: Client, data: UserRoleInsert) {
  return supabase.from("user_roles").insert(data).select("*, roles(*)").single();
}

export async function removeRole(supabase: Client, userRoleId: string) {
  return supabase.from("user_roles").delete().eq("id", userRoleId);
}

export async function hasRole(
  supabase: Client,
  userId: string,
  roleName: string,
  scopeType?: string,
  scopeId?: string
) {
  let query = supabase
    .from("user_roles")
    .select("id, roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", roleName);

  if (scopeType && scopeId) {
    query = query
      .or(`and(scope_type.is.null),and(scope_type.eq.${scopeType},scope_id.eq.${scopeId})`);
  }

  const { data, error } = await query.limit(1);
  return { hasRole: (data?.length ?? 0) > 0, error };
}

// ── Role bundles (job titles) ──────────────────────────────────
// A role is a reusable bundle of permissions (role_permissions).
// These run through the admin client from API routes that have
// already authorized the caller; RLS keeps direct writes super_admin-only.

export async function createRole(
  supabase: Client,
  data: { name: string; display_name: string; description?: string | null }
) {
  return supabase
    .from("roles")
    .insert({ ...data, is_system: false })
    .select("*")
    .single();
}

export async function updateRole(
  supabase: Client,
  roleId: string,
  data: { display_name?: string; description?: string | null }
) {
  return supabase.from("roles").update(data).eq("id", roleId).select("*").single();
}

/** Delete a non-system role. role_permissions + user_roles cascade. */
export async function deleteRole(supabase: Client, roleId: string) {
  return supabase.from("roles").delete().eq("id", roleId).eq("is_system", false);
}

export async function getRolePermissionIds(
  supabase: Client,
  roleId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("role_permissions")
    .select("permission_id")
    .eq("role_id", roleId);
  return (data ?? []).map((r: { permission_id: string }) => r.permission_id);
}

/** Replace a role's whole bundle with the given permission ids. */
export async function setRolePermissions(
  supabase: Client,
  roleId: string,
  permissionIds: string[]
) {
  await supabase.from("role_permissions").delete().eq("role_id", roleId);
  if (permissionIds.length === 0) return { error: null };
  return supabase
    .from("role_permissions")
    .insert(permissionIds.map((pid) => ({ role_id: roleId, permission_id: pid })));
}

/** Map of role_id -> number of people currently holding that role. */
export async function getRoleMemberCounts(
  supabase: Client
): Promise<Record<string, number>> {
  const { data } = await supabase.from("user_roles").select("role_id");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { role_id: string }[]) {
    counts[row.role_id] = (counts[row.role_id] ?? 0) + 1;
  }
  return counts;
}

export type RoleMember = {
  id: string;
  name: string;
  email: string | null;
  /**
   * True only when Supabase Auth has no sign-in on record. NOT users.status —
   * that column is stale for people who joined long ago (it still reads
   * "invited" for accounts signing in daily), so it would brand active staff
   * as pending. See lib/users/auth-signins.ts.
   */
  neverSignedIn: boolean;
  /** Set when the assignment is scoped (e.g. program_leader on one program). */
  scopeType: string | null;
};

/**
 * Map of role_id -> the people holding it, for the "who has this role?" list
 * on /roles.
 *
 * Identity fields are read with the SERVICE-ROLE client on purpose. RLS on
 * `users` nulls out embedded joins for anyone who is not an admin, which would
 * render a list of "Unknown" names for a manage_roles holder. The fix is to
 * hydrate the few identity fields here — never to widen the users policy,
 * which guards personal data.
 *
 * Callers must gate this themselves: /roles only calls it for super admins.
 */
export async function getRoleMembers(
  supabase: Client,
  adminClient: Client
): Promise<Record<string, RoleMember[]>> {
  const { data: assignments } = await supabase
    .from("user_roles")
    .select("role_id, user_id, scope_type");

  const rows = (assignments ?? []) as {
    role_id: string;
    user_id: string;
    scope_type: string | null;
  }[];
  if (rows.length === 0) return {};

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const [{ data: people }, signIns] = await Promise.all([
    adminClient
      .from("users")
      .select("id, first_name, last_name, display_name, email")
      .in("id", userIds),
    getAuthSignIns(),
  ]);

  const byId = new Map<string, RoleMember>();
  for (const p of (people ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    email: string | null;
  }[]) {
    const name =
      p.display_name ||
      [p.first_name, p.last_name].filter(Boolean).join(" ") ||
      p.email ||
      "Unnamed";
    byId.set(p.id, {
      id: p.id,
      name,
      email: p.email,
      neverSignedIn: !signIns.get(p.id),
      scopeType: null,
    });
  }

  const out: Record<string, RoleMember[]> = {};
  for (const r of rows) {
    const person = byId.get(r.user_id);
    if (!person) continue; // deleted profile whose assignment outlived it
    (out[r.role_id] ||= []).push({ ...person, scopeType: r.scope_type });
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}
