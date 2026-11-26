// Test-only: P&W with its three L10 teams, in memory, shaped like 416.
import { createMemoryDb, type Rls, type Row } from "./memory-db";

export const PW_ID = "00000000-0000-4000-8000-0000000000a1";
export const PRODUCTION = "00000000-0000-4000-8000-0000000000b1";
export const LIVE = "00000000-0000-4000-8000-0000000000b2";
export const TEAM3 = "00000000-0000-4000-8000-0000000000b3";

export const LEAD = "00000000-0000-4000-8000-0000000000c1"; // Production team leader
export const SINGER = "00000000-0000-4000-8000-0000000000c2"; // Production member
export const NOSLACK = "00000000-0000-4000-8000-0000000000c3"; // Production member, no Slack id
export const LIVE_ONLY = "00000000-0000-4000-8000-0000000000c4"; // P&W member on Live, not on Production
export const OUTSIDER = "00000000-0000-4000-8000-0000000000c5"; // not in P&W
export const DEPT_LEAD = "00000000-0000-4000-8000-0000000000c6"; // P&W department leader: overseer, on no team

export const MEETING_TODO = "00000000-0000-4000-8000-0000000000d1";
export const OLD_TODO = "00000000-0000-4000-8000-0000000000d2";
export const DONE_TODO = "00000000-0000-4000-8000-0000000000d3";
export const ROCK = "00000000-0000-4000-8000-0000000000e1";
export const DEPT_ROCK = "00000000-0000-4000-8000-0000000000e2";

const team = (id: string, slug: string, name: string, sort_order: number) => ({
  id,
  department_id: PW_ID,
  slug,
  name,
  meeting_weekday: 2,
  meeting_time: "09:00:00",
  meeting_timezone: "Africa/Johannesburg",
  facilitator_id: null,
  slack_channel_id: null,
  sort_order,
  is_active: true,
});

export function makeWorld(extra: Record<string, Row[]> = {}) {
  const seed: Record<string, Row[]> = {
    staff_ministries: [{ id: PW_ID, slug: "prayer_and_worship", name: "Prayer & Worship" }],
    l10_teams: [team(PRODUCTION, "production", "Production", 1), team(LIVE, "live", "Live", 2), team(TEAM3, "team-3", "Team 3", 3)],
    l10_team_members: [
      { id: "m1", team_id: PRODUCTION, profile_id: LEAD, role: "leader" },
      { id: "m2", team_id: PRODUCTION, profile_id: SINGER, role: "member" },
      { id: "m3", team_id: PRODUCTION, profile_id: NOSLACK, role: "member" },
      { id: "m4", team_id: LIVE, profile_id: LIVE_ONLY, role: "member" },
    ],
    users: [
      { id: LEAD, first_name: "Thandi", preferred_name: null, last_name: "M", slack_user_id: "U_LEAD" },
      { id: SINGER, first_name: "Sipho", preferred_name: "Sip", last_name: "K", slack_user_id: "U_SINGER" },
      { id: NOSLACK, first_name: "Anna", preferred_name: null, last_name: "B", slack_user_id: null },
      { id: LIVE_ONLY, first_name: "Lee", preferred_name: null, last_name: "V", slack_user_id: "U_LIVE" },
      { id: DEPT_LEAD, first_name: "Dee", preferred_name: null, last_name: "L", slack_user_id: "U_DEPT" },
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
    unique: (table, row, all) =>
      table !== "l10_measurable_values" ||
      !all.some((r) => r.measurable_id === row.measurable_id && r.week_start === row.week_start),
  });
}

const OVERSEERS = new Set([DEPT_LEAD]);

/** 416's helpers and RLS, as this API relies on them. */
export function pwRls(tables: Record<string, Row[]>): Rls {
  const onTeam = (teamId: unknown, uid: string | null, leadersOnly = false) =>
    !!uid &&
    (tables.l10_team_members ?? []).some(
      (m) => m.team_id === teamId && m.profile_id === uid && (!leadersOnly || m.role === "leader")
    );
  const canAccess = (teamId: unknown, uid: string | null) => (!!uid && OVERSEERS.has(uid)) || onTeam(teamId, uid);
  const canManage = (teamId: unknown, uid: string | null) => (!!uid && OVERSEERS.has(uid)) || onTeam(teamId, uid, true);
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
      if (table === "l10_teams") return !!uid && OVERSEERS.has(uid);
      return canAccess(teamOf(table, row), uid);
    },
    rpc: (name, args, uid) => {
      if (name === "l10_can_access_team") return canAccess(args.p_team_id, uid);
      if (name === "l10_can_manage_team") return canManage(args.p_team_id, uid);
      return false;
    },
  };
}
