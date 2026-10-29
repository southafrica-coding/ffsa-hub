/**
 * Outreach team roles (migration 260). The owner (whoever created the
 * outreach) and the co-leaders they invite run the money; team members
 * are on the trip but don't see the budget.
 */
export const OUTREACH_LEADER_ROLES = ["owner", "co_leader"];

export const OUTREACH_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  co_leader: "Co-leader",
  team_member: "Team member",
};
