/**
 * Who may see and change an outreach team: three layers (migration 273).
 *
 *   TEAM     the roster. Owner and co-leaders run the money; plain members
 *            see the trip, not the money (migration 260).
 *   GROUP    teams bundled by category. A team may be in several groups.
 *   MANAGER  assigned to groups, never to single teams. Edits every team in
 *            the groups they manage, as a co-leader would.
 *
 * And across groups: a team's leaders READ every other team in any group
 * their own team is in. Outreach staff (is_outreach_staff_viewer / _editor)
 * keep seeing — and, for editors, changing — every team.
 *
 * The database enforces all of this in RLS (can_view_outreach_team,
 * can_edit_outreach_team). This module is the same rule for the server
 * side of the app: pages decide what to render from it and never trust the
 * browser. Group membership is read on every request, so a team taken out
 * of a group drops out of its managers' access on their next page load.
 *
 * A person flagged "outreach limited to own teams" (migration 274) is not
 * outreach staff through finance.view / finance.edit: they get only what
 * their own teams and the groups they manage give them. Admins and the
 * finance_admin role are unaffected by the flag.
 */

import { OUTREACH_LEADER_ROLES } from "@/lib/finance/outreach-roles";

/** "edit" = run the money; "view" = read it; "member" = the money-free trip view. */
export type OutreachAccessLevel = "edit" | "view" | "member" | null;

/** Why the viewer has that access — shown on the team page and in lists. */
export type OutreachAccessVia = "staff" | "leader" | "manager" | "group_peer" | "member" | null;

export type OutreachAccess = { level: OutreachAccessLevel; via: OutreachAccessVia };

/** Everything about the viewer that decides their outreach access. */
export type OutreachViewer = {
  /** is_outreach_staff_viewer(): admins, finance_admin, finance.view / finance.edit. */
  staffViewer: boolean;
  /** is_outreach_staff_editor(): admins, finance_admin, finance.edit. */
  staffEditor: boolean;
  /** team_id → the viewer's role on that team. */
  roles: Record<string, string>;
  /** Groups the viewer manages. */
  managedGroupIds: string[];
  /** group_id → the team ids in it, for every group the viewer can see. */
  groupTeams: Record<string, string[]>;
  /** Flagged "outreach limited to own teams" (migration 274). */
  limitedToOwnTeams: boolean;
};

export const NO_ACCESS: OutreachAccess = { level: null, via: null };

function isLeaderRole(role: string | undefined): boolean {
  return !!role && OUTREACH_LEADER_ROLES.includes(role);
}

/** The groups a team is in, among those the viewer can see. */
export function groupsOfTeam(viewer: OutreachViewer, teamId: string): string[] {
  return Object.keys(viewer.groupTeams).filter((g) => viewer.groupTeams[g].includes(teamId));
}

/** Groups that hold at least one team the viewer owns or co-leads. */
export function ledGroupIds(viewer: OutreachViewer): string[] {
  return Object.keys(viewer.groupTeams).filter((g) =>
    viewer.groupTeams[g].some((t) => isLeaderRole(viewer.roles[t]))
  );
}

/**
 * The viewer's access to one team. Mirrors can_edit_outreach_team() then
 * can_view_outreach_team() in migration 273: anything that grants edit wins
 * over anything that only grants view.
 */
export function resolveTeamAccess(viewer: OutreachViewer, teamId: string): OutreachAccess {
  const role = viewer.roles[teamId];
  const teamGroups = groupsOfTeam(viewer, teamId);

  if (viewer.staffEditor) return { level: "edit", via: "staff" };
  if (isLeaderRole(role)) return { level: "edit", via: "leader" };
  if (teamGroups.some((g) => viewer.managedGroupIds.includes(g))) {
    return { level: "edit", via: "manager" };
  }
  if (viewer.staffViewer) return { level: "view", via: "staff" };
  const led = ledGroupIds(viewer);
  if (teamGroups.some((g) => led.includes(g))) return { level: "view", via: "group_peer" };
  if (role) return { level: "member", via: "member" };
  return NO_ACCESS;
}

/** True when the viewer may change the team's money, members and status. */
export function canEditTeam(viewer: OutreachViewer, teamId: string): boolean {
  return resolveTeamAccess(viewer, teamId).level === "edit";
}

/** May add teams to / take teams out of this group (can_manage_outreach_group). */
export function canManageGroupTeams(viewer: OutreachViewer, groupId: string): boolean {
  return viewer.staffEditor || viewer.managedGroupIds.includes(groupId);
}

/** May create, rename and delete groups and assign their managers. */
export function canEditGroups(viewer: OutreachViewer): boolean {
  return viewer.staffEditor;
}

/**
 * The teams in `teams` this viewer may open at all. RLS already limits the
 * list; for a viewer flagged "limited to own teams" the app also drops
 * anything the resolver does not grant, so the flag holds even if the
 * database answer is behind.
 */
export function teamsVisibleTo<T extends { id: string }>(viewer: OutreachViewer | null, teams: T[]): T[] {
  if (!viewer || !viewer.limitedToOwnTeams) return teams;
  return teams.filter((t) => resolveTeamAccess(viewer, t.id).level !== null);
}

/** Short label for how the viewer reaches a team, or null for nothing to say. */
export function accessLabel(access: OutreachAccess): string | null {
  switch (access.via) {
    case "manager":
      return "Group manager";
    case "group_peer":
      return "View only";
    case "staff":
      return access.level === "view" ? "View only" : null;
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────
// Building the viewer from rows the server read
// ────────────────────────────────────────────────────────────

export function buildOutreachViewer(input: {
  staffViewer: boolean;
  staffEditor: boolean;
  memberships: { team_id: string; role: string }[];
  managedGroupIds: string[];
  groupTeamLinks: { group_id: string; team_id: string }[];
  /** The viewer's own "limited to own teams" flag (migration 274). */
  limitedToOwnTeams?: boolean;
  /** is_admin() or the finance_admin role — the staff paths the flag leaves open. */
  roleStaff?: boolean;
}): OutreachViewer {
  const roles: Record<string, string> = {};
  for (const m of input.memberships) roles[m.team_id] = m.role;
  const groupTeams: Record<string, string[]> = {};
  for (const g of input.managedGroupIds) groupTeams[g] = [];
  for (const l of input.groupTeamLinks) {
    (groupTeams[l.group_id] ??= []).push(l.team_id);
  }
  // A flagged viewer is staff only through an admin tier or finance_admin,
  // never through finance.view / finance.edit — the same carve-out as
  // is_outreach_staff_viewer() / _editor() in migration 274. Applied here
  // too so the app holds the line even where the database answer is stale.
  const limited = input.limitedToOwnTeams === true;
  const staffAllowed = !limited || input.roleStaff === true;
  return {
    staffViewer: (input.staffViewer || input.staffEditor) && staffAllowed,
    staffEditor: input.staffEditor && staffAllowed,
    roles,
    managedGroupIds: [...new Set(input.managedGroupIds)],
    groupTeams,
    limitedToOwnTeams: limited,
  };
}

/** Plain UUID check for ids arriving in request bodies and query strings. */
export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
