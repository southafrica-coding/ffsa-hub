// Authorization check for grant-permission / revoke-permission endpoints.
// Returns true if the caller is allowed to make the requested change.
//
// Rules:
//   - `schools.assignable_as_contact` is scoped-only: it must always be
//     granted/revoked with scope_type='program'. A global grant is
//     rejected no matter who the caller is — a user is only assignable
//     as a point of contact for the exact program(s) granted.
//   - super_admin can do anything else; admin (General Admin) too, except
//     the Records Library permission.
//   - A schools.manage holder can grant/revoke ONLY
//     `schools.assignable_as_contact`, scoped to a program they
//     themselves have `schools.manage` on. (Global schools.manage
//     means any program.)

import { SUPER_ADMIN_ONLY_PERMISSION_KEYS } from "./check-role-grant";
import { getSchoolsManageScopes, canManageAssignmentsOnProgram } from "./schools-manage-scopes";

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const ASSIGNABLE_CONTACT_KEY = "schools.assignable_as_contact";

export async function callerCanGrantPermission(
  supabase: Client,
  callerUserId: string,
  permissionId: string,
  scopeType: string | null | undefined,
  scopeId: string | null | undefined
): Promise<boolean> {
  // Resolve the permission key first.
  const { data: permRow } = await supabase
    .from("permissions")
    .select("key")
    .eq("id", permissionId)
    .single();
  const permKey = (permRow as { key?: string } | null)?.key;

  // schools.assignable_as_contact must always be program-scoped.
  const isAssignableContact = permKey === ASSIGNABLE_CONTACT_KEY;
  if (isAssignableContact && (scopeType !== "program" || !scopeId)) {
    return false;
  }

  // super_admin can grant anything that passed the guard above. admin
  // (General Admin) can too, except the super-admin-only keys (Records Library).
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", callerUserId)
    .in("roles.name", ["super_admin", "admin"]);
  const tiers = new Set(
    ((roleRows ?? []) as { roles: { name: string } | { name: string }[] }[]).map(
      (r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name)
    )
  );
  if (tiers.has("super_admin")) return true;
  if (tiers.has("admin")) return !SUPER_ADMIN_ONLY_PERMISSION_KEYS.has(permKey ?? "");

  // Non-super-admins: only schools.assignable_as_contact, only on a
  // program they manage.
  if (!isAssignableContact) return false;

  const scopes = await getSchoolsManageScopes(supabase, callerUserId);
  return canManageAssignmentsOnProgram(scopes, scopeId ?? null);
}
