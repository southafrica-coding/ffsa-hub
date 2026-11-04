// Who gets a "booking request waiting" push: exactly the people whose
// dashboard feed would show the request (services/notifications.ts
// bookingNotifs → getBookingAccess().canApprove): admins and super admins,
// plus anyone holding bookings.approve directly or through a role's bundle.
// Service-role reads (other users' grants aren't visible under RLS); only
// user ids leave this function.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APPROVE_KEY = "bookings.approve";
const ADMIN_ROLES = ["super_admin", "admin"];

export async function bookingApproverIds(admin: Client): Promise<string[]> {
  const [adminRoles, direct, bundles] = await Promise.all([
    admin.from("user_roles").select("user_id, roles!inner(name)").in("roles.name", ADMIN_ROLES),
    admin
      .from("user_permissions")
      .select("user_id, permissions!inner(key)")
      .eq("permissions.key", APPROVE_KEY),
    admin
      .from("role_permissions")
      .select("role_id, permissions!inner(key)")
      .eq("permissions.key", APPROVE_KEY),
  ]);

  const ids = new Set<string>();
  for (const r of (adminRoles.data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  for (const r of (direct.data ?? []) as { user_id: string }[]) ids.add(r.user_id);

  const roleIds = ((bundles.data ?? []) as { role_id: string }[]).map((r) => r.role_id);
  if (roleIds.length > 0) {
    const { data } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
    for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  }
  return Array.from(ids);
}
