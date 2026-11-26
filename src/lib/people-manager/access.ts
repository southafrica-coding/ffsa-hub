// The approver rule from 421 (leave_user_can_decide /
// leave_request_approvers), as plain functions for the Slack fan-out tests
// and the API's "goes to" line. The database enforces the same rule on every
// decision; these never grant anything on their own.
//
//   * Staff leave: any active leader of the request's department.
//   * A leader's leave: the department's other leaders.
//   * A sole leader's leave (no other leader): the active unscoped admins.
//   * Nobody decides their own request. An admin may always decide.

export type Approver = { user_id: string; via: "leader" | "admin" };

/** Who is asked, in 421's order: other leaders, else admins. Never the requester. */
export function routeApprovers(input: {
  requesterId: string;
  leaderIds: readonly string[];
  adminIds: readonly string[];
}): Approver[] {
  const leaders = [...new Set(input.leaderIds)].filter((id) => id !== input.requesterId);
  if (leaders.length) return leaders.map((user_id) => ({ user_id, via: "leader" as const }));
  return [...new Set(input.adminIds)]
    .filter((id) => id !== input.requesterId)
    .map((user_id) => ({ user_id, via: "admin" as const }));
}

/** May `userId` decide this request? */
export function canDecide(input: {
  requesterId: string;
  userId: string | null;
  isLeaderOfDepartment: boolean;
  isAdmin: boolean;
}): boolean {
  if (!input.userId || input.userId === input.requesterId) return false;
  return input.isLeaderOfDepartment || input.isAdmin;
}
