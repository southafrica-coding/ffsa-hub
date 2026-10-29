// Prayer Room authorization helpers for route handlers.
//
// RLS enforces these rules for WRITES via the user client. These helpers
// re-check authorization in routes that read via the ADMIN client (which
// bypasses RLS) or that perform privileged multi-step writes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const STAFF_ROLES = ["super_admin", "admin", "prayer_room_admin"];

/** Coordinator/staff: a managing role OR the prayer_room.manage permission. */
export async function isPrayerRoomStaff(supabase: Client, userId: string): Promise<boolean> {
  // Either one is enough, and neither depends on the other — ask together.
  const [{ data: roles }, { data: perms }] = await Promise.all([
    supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", userId)
      .in("roles.name", STAFF_ROLES)
      .limit(1),
    supabase
      .from("user_permissions")
      .select("permissions!inner(key)")
      .eq("user_id", userId)
      .eq("permissions.key", "prayer_room.manage")
      .limit(1),
  ]);
  if (roles && roles.length > 0) return true;
  return !!(perms && perms.length > 0);
}

/**
 * Evaluator: holds the `prayer_room.evaluate` permission, granted directly or
 * via an assigned role. This replaced the old per-member is_evaluator flag —
 * evaluator access is now managed in the central permissions section.
 */
export async function isPrayerRoomEvaluator(supabase: Client, userId: string): Promise<boolean> {
  const { data: direct } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .eq("permissions.key", "prayer_room.evaluate")
    .limit(1);
  if (direct && direct.length > 0) return true;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);
  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id);
  if (roleIds.length === 0) return false;

  const { data: viaRole } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .eq("permissions.key", "prayer_room.evaluate")
    .limit(1);
  return !!(viaRole && viaRole.length > 0);
}

/**
 * Baseline staff who may view the read-only Prayer Room Directory.
 * The general `staff` role (plus the managing roles) can see the directory
 * without gaining Evaluations or Manage access, which stay gated on
 * `isPrayerRoomStaff` / `isPrayerRoomEvaluator`.
 */
const DIRECTORY_ROLES = ["staff", ...STAFF_ROLES];

export async function canViewDirectory(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", DIRECTORY_ROLES)
    .limit(1);
  return !!(data && data.length > 0);
}

/** Active, approved prayer-room team member. */
export async function isApprovedMember(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("prayer_room_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  return !!(data && data.length > 0);
}

/** True if the user is the assigned evaluator on the given application. */
export async function isAssignedEvaluator(
  supabase: Client,
  userId: string,
  applicationId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("prayer_room_applications")
    .select("evaluator_id")
    .eq("id", applicationId)
    .maybeSingle();
  return !!data && data.evaluator_id === userId;
}
