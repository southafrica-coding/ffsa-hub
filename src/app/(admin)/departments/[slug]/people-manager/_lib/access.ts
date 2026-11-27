import { rpcFlag } from "@/lib/departments/rpc";
import type { DepartmentHome } from "@/lib/departments/ui-contract";

export type PeopleManagerAccess = {
  /** Show the People Manager at all (department home link, People tab segments). */
  canUse: boolean;
  /** A member: "My time off" and the request form. */
  canRequest: boolean;
  /** A leader or an admin: the queue, the timeline, usage for everyone. */
  canManage: boolean;
};

export const NO_PEOPLE_MANAGER: PeopleManagerAccess = { canUse: false, canRequest: false, canManage: false };

/**
 * The same split as the leave API's `me` (handlers.ts): members can request,
 * leaders and admins see the department. Membership comes from the home
 * model the page already loaded; admin from 421's existing
 * leave_caller_is_admin(). An RPC error is "not an admin", so the
 * department home never breaks over the link.
 */
export async function peopleManagerAccess(
  supabase: unknown,
  home: Pick<DepartmentHome, "department">
): Promise<PeopleManagerAccess> {
  const membership = home.department.viewerMembership;
  let isAdmin = false;
  try {
    const flag = await rpcFlag(supabase, "leave_caller_is_admin");
    isAdmin = flag.ok && flag.value;
  } catch {
    isAdmin = false;
  }
  const canRequest = membership !== "none";
  const canManage = membership === "leader" || isAdmin;
  return { canUse: canRequest || canManage, canRequest, canManage };
}
