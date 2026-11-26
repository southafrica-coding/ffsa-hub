// Test-only: departments with L10 teams, in memory, shaped like 416.
// P&W (three teams, Production and Live paired, Team 3 unpaired) is one
// fixture; a second department proves nothing is special-cased.
import { L10_ONE_AUTO_RECAP_INDEX, L10_ONE_OPEN_MEETING_INDEX } from "@/lib/departments/db.types";
import { createMemoryDb, type Rls, type Row } from "./memory-db";

export const PW_ID = "00000000-0000-4000-8000-0000000000a1";
export const PRODUCTION = "00000000-0000-4000-8000-0000000000b1";
export const LIVE = "00000000-0000-4000-8000-0000000000b2";
export const TEAM3 = "00000000-0000-4000-8000-0000000000b3";

export const LEAD = "00000000-0000-4000-8000-0000000000c1"; // Production team leader
export const SINGER = "00000000-0000-4000-8000-0000000000c2"; // Production member
export const NOSLACK = "00000000-0000-4000-8000-0000000000c3"; // Production member, no Slack id
export const LIVE_ONLY = "00000000-0000-4000-8000-0000000000c4"; // P&W member on Live, not on Production
export const OUTSIDER = "00000000-0000-4000-8000-0000000000c5"; // in no department
export const DEPT_LEAD = "00000000-0000-4000-8000-0000000000c6"; // P&W department leader: overseer, on no team

// A second department with its own two paired teams.
export const OPS_ID = "00000000-0000-4000-8000-0000000001a1";
export const OPS_SLUG = "operations";
export const GROUNDS = "00000000-0000-4000-8000-0000000001b1";
export const KITCHEN = "00000000-0000-4000-8000-0000000001b2";
export const GROUNDS_LEAD = "00000000-0000-4000-8000-0000000001c1";
export const COOK = "00000000-0000-4000-8000-0000000001c2";
export const OPS_LEAD = "00000000-0000-4000-8000-0000000001c3"; // Operations department leader

export const MEETING_TODO = "00000000-0000-4000-8000-0000000000d1";
export const OLD_TODO = "00000000-0000-4000-8000-0000000000d2";
export const DONE_TODO = "00000000-0000-4000-8000-0000000000d3";
export const ROCK = "00000000-0000-4000-8000-0000000000e1";
export const DEPT_ROCK = "00000000-0000-4000-8000-0000000000e2";

const team = (id: string, department_id: string, slug: string, name: string, sort_order: number, recap_source_team_id: string | null) => ({
  id,
  department_id,
  slug,
  name,
  meeting_weekday: 2,
  meeting_time: "09:00:00",
  meeting_timezone: "Africa/Johannesburg",
  facilitator_id: null,
  slack_channel_id: null,
  recap_source_team_id,
  sort_order,
  is_active: true,
});

export function makeWorld(extra: Record<string, Row[]> = {}) {
  const seed: Record<string, Row[]> = {
    staff_ministries: [
      { id: PW_ID, slug: "prayer_and_worship", name: "Prayer & Worship" },
      { id: OPS_ID, slug: OPS_SLUG, name: "Operations" },
    ],
    l10_teams: [
      team(PRODUCTION, PW_ID, "production", "Production", 1, LIVE),
      team(LIVE, PW_ID, "live", "Live", 2, PRODUCTION),
      team(TEAM3, PW_ID, "team-3", "Team 3", 3, null),
      team(GROUNDS, OPS_ID, "grounds", "Grounds", 1, KITCHEN),
      team(KITCHEN, OPS_ID, "kitchen", "Kitchen", 2, GROUNDS),
    ],
    l10_team_members: [
      { id: "m1", team_id: PRODUCTION, profile_id: LEAD, role: "leader" },
      { id: "m2", team_id: PRODUCTION, profile_id: SINGER, role: "member" },
      { id: "m3", team_id: PRODUCTION, profile_id: NOSLACK, role: "member" },
      { id: "m4", team_id: LIVE, profile_id: LIVE_ONLY, role: "member" },
      { id: "m5", team_id: TEAM3, profile_id: LEAD, role: "member" },
      { id: "o1", team_id: GROUNDS, profile_id: GROUNDS_LEAD, role: "leader" },
      { id: "o2", team_id: GROUNDS, profile_id: COOK, role: "member" },
      { id: "o3", team_id: KITCHEN, profile_id: COOK, role: "leader" },
    ],
    users: [
      { id: LEAD, first_name: "Thandi", preferred_name: null, last_name: "M", slack_user_id: "U_LEAD" },
      { id: SINGER, first_name: "Sipho", preferred_name: "Sip", last_name: "K", slack_user_id: "U_SINGER" },
      { id: NOSLACK, first_name: "Anna", preferred_name: null, last_name: "B", slack_user_id: null },
      { id: LIVE_ONLY, first_name: "Lee", preferred_name: null, last_name: "V", slack_user_id: "U_LIVE" },
      { id: DEPT_LEAD, first_name: "Dee", preferred_name: null, last_name: "L", slack_user_id: "U_DEPT" },
      { id: GROUNDS_LEAD, first_name: "Gugu", preferred_name: null, last_name: "N", slack_user_id: "U_GROUNDS" },
      { id: COOK, first_name: "Kim", preferred_name: null, last_name: "C", slack_user_id: "U_COOK" },
      { id: OPS_LEAD, first_name: "Olu", preferred_name: null, last_name: "D", slack_user_id: "U_OPS" },
    ],
    rocks: [
      { id: ROCK, team_id: PRODUCTION, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "New stage plot", description: null, owner_user_id: LEAD, status: "on_track", due_on: null },
      { id: DEPT_ROCK, team_id: null, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "Department rock", description: null, owner_user_id: null, status: "on_track", due_on: null },
    ],
    l10_todos: [],
    l10_issues: [],
    l10_headlines: [],
    l10_measurables: [],
    l10_measurable_values: [],
    l10_meetings: [],
    l10_meeting_attendees: [],
    ...extra,
  };
  return createMemoryDb(seed, {
    unique: (table, row, all) => {
      if (table === "l10_measurable_values") {
        return !all.some((r) => r.measurable_id === row.measurable_id && r.week_start === row.week_start);
      }
      if (table === "l10_headlines" && row.is_auto) {
        const clash = all.some((r) => r.is_auto && r.source_meeting_id === row.source_meeting_id && r.recap_of_meeting_id === row.recap_of_meeting_id);
        return clash ? L10_ONE_AUTO_RECAP_INDEX : true;
      }
      if (table === "l10_meetings" && row.ended_at == null) {
        return all.some((r) => r.team_id === row.team_id && r.ended_at == null) ? L10_ONE_OPEN_MEETING_INDEX : true;
      }
      return true;
    },
  });
}

/** Department leaders (overseers), by department. */
const OVERSEERS: Record<string, string[]> = { [PW_ID]: [DEPT_LEAD], [OPS_ID]: [OPS_LEAD] };

/** 416's helpers and RLS, as this API relies on them. Nothing department-specific. */
export function l10Rls(tables: Record<string, Row[]>): Rls {
  const deptOf = (teamId: unknown) => (tables.l10_teams ?? []).find((t) => t.id === teamId)?.department_id as string | undefined;
  const oversees = (teamId: unknown, uid: string | null) => !!uid && (OVERSEERS[deptOf(teamId) ?? ""] ?? []).includes(uid);
  const onTeam = (teamId: unknown, uid: string | null, leadersOnly = false) =>
    !!uid &&
    (tables.l10_team_members ?? []).some(
      (m) => m.team_id === teamId && m.profile_id === uid && (!leadersOnly || m.role === "leader")
    );
  const canAccess = (teamId: unknown, uid: string | null) => oversees(teamId, uid) || onTeam(teamId, uid);
  const canManage = (teamId: unknown, uid: string | null) => oversees(teamId, uid) || onTeam(teamId, uid, true);
  const teamOf = (table: string, row: Row) => (table === "l10_teams" ? row.id : row.team_id);
  return {
    read: (table, row, uid) => {
      if (table === "audit_logs" || table === "users" || table === "staff_ministries") return true;
      if (table === "rocks" && row.team_id == null) return true;
      return canAccess(teamOf(table, row), uid);
    },
    write: (table, row, uid) => {
      if (table === "audit_logs") return true;
      if (table === "l10_team_members") return canManage(row.team_id, uid);
      if (table === "l10_teams") return oversees(row.id, uid);
      return canAccess(teamOf(table, row), uid);
    },
    rpc: (name, args, uid) => {
      if (name === "l10_can_access_team") return canAccess(args.p_team_id, uid);
      if (name === "l10_can_manage_team") return canManage(args.p_team_id, uid);
      return false;
    },
  };
}

/** Kept for the P&W-named tests. */
export const pwRls = l10Rls;
