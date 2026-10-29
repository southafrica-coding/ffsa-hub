// A Super Admin's account belongs to the Super Admin tier.
//
// Migration 263 gave General Admins (`admin`) every power a super_admin has
// except the Records Library — including, by accident, the power to switch
// off, delete, convert, re-title or demote a super admin. That is the one
// tier a General Admin must not be able to act on: it would let them remove
// the only people above them.
//
// So every route that changes someone's account standing (active flag,
// deletion, merge, membership role, job titles, admin tiers, login email)
// asks refuseSuperAdminTarget() first. Migration 267 enforces the same rule
// in RLS for writes made through a user's own session.

import { NextResponse } from "next/server";
import { callerIsSuperAdmin } from "./check-role-grant";

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const SUPER_ADMIN_TARGET_ERROR =
  "Only a Super Admin can change a Super Admin's account.";

/** The rule itself: a super admin's account is only a super admin's to change. */
export function canChangeAccount(
  callerIsSuper: boolean,
  targetIsSuper: boolean
): boolean {
  return callerIsSuper || !targetIsSuper;
}

/**
 * Does any of these accounts hold super_admin? Read with the service-role
 * client — a lookup that silently returns nothing would wave the change
 * through, so a failed read throws instead (the route answers 500).
 */
export async function anyIsSuperAdmin(
  reader: Client,
  userIds: string[]
): Promise<boolean> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return false;
  const { data, error } = await reader
    .from("user_roles")
    .select("user_id, roles!inner(name)")
    .in("user_id", ids)
    .eq("roles.name", "super_admin")
    .limit(1);
  if (error) throw new Error(`Could not check super admin status: ${error.message}`);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/**
 * A 403 response when any target is a super admin and the caller is not one;
 * null when the change may go ahead.
 *
 * `caller` is the caller's own session client (for their roles), `reader` the
 * service-role client (for the target's).
 */
export async function refuseSuperAdminTarget(
  caller: Client,
  callerId: string,
  reader: Client,
  targetIds: string | string[]
): Promise<NextResponse | null> {
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  if (!(await anyIsSuperAdmin(reader, ids))) return null;
  if (canChangeAccount(await callerIsSuperAdmin(caller, callerId), true)) {
    return null;
  }
  return NextResponse.json({ error: SUPER_ADMIN_TARGET_ERROR }, { status: 403 });
}
