// L10 (any department): the table, column and value names the server uses, aligned with
// migration 416 (Hub Data, PR #739) and 420 (PR #744: department_id on
// meetings and headlines, filled by trigger; clients never send it). Row types
// come from lib/departments/db.types.ts; this file only adds the table names,
// the column lists the API selects, and the item kinds.

export {
  L10_GOAL_DIRECTIONS,
  L10_ISSUE_STATUSES,
  L10_MEASURABLE_UNITS,
  L10_SEGMENTS,
  L10_TEAM_ROLES,
} from "@/lib/departments/db.types";
export type {
  L10GoalDirection,
  L10Headline,
  L10Issue,
  L10IssueStatus,
  L10Measurable,
  L10MeasurableUnit,
  L10MeasurableValue,
  L10Meeting,
  L10MeetingAttendee,
  L10Segment,
  L10SegmentTiming,
  L10SegmentTimings,
  L10Team,
  L10TeamMember,
  L10TeamRock,
  L10TeamRole,
  L10Todo,
} from "@/lib/departments/db.types";
export { ROCK_STATUSES } from "@/lib/departments/db.types";

export {
  L10_ATTENDEE_IMMUTABLE,
  L10_AUTO_HEADLINE_INCOMPLETE,
  L10_AUTO_HEADLINE_LOCKED,
  L10_ONE_AUTO_RECAP_INDEX,
  L10_ONE_OPEN_MEETING_INDEX,
  L10_RATING_NOT_ALLOWED,
} from "@/lib/departments/db.types";

// Cross-team headline: 416 (#739 at 6683bde2) ships l10_teams.recap_source_team_id
// (same department, never itself), l10_headlines.is_auto / recap_of_meeting_id /
// dismissed_at and the unique index l10_headlines_one_auto_recap.

/** A team row, with its recap pairing. */
export type L10TeamRow = import("@/lib/departments/db.types").L10Team;
/** A headline row, with the auto-headline columns. */
export type L10HeadlineRow = import("@/lib/departments/db.types").L10Headline;

/** API code: the team already has an open meeting (409). */
export const L10_MEETING_ALREADY_OPEN = "l10_meeting_already_open" as const;
/** Error code when a user tries to set an auto-only headline field. */
export const L10_AUTO_HEADLINE_FIELD = "l10_auto_headline_field" as const;
/** Headline columns only the Hub sets. */
export const L10_AUTO_HEADLINE_FIELDS = ["is_auto", "recap_of_meeting_id", "dismissed_at"] as const;

export const L10_TABLES = {
  teams: "l10_teams",
  members: "l10_team_members",
  /** 320's public.rocks; a team rock has team_id set. */
  rocks: "rocks",
  measurables: "l10_measurables",
  measurable_values: "l10_measurable_values",
  todos: "l10_todos",
  issues: "l10_issues",
  headlines: "l10_headlines",
  meetings: "l10_meetings",
  attendees: "l10_meeting_attendees",
} as const;

export const L10_SEGMENT_LABELS = {
  segue: "Segue",
  scorecard: "Scorecard",
  rock_review: "Rock review",
  headlines: "Customer & staff headlines",
  todo_list: "To-do list",
  ids: "IDS",
  conclude: "Conclude",
} as const;

/** Issues not yet solved. They stay on the team's IDS list until solved. */
export const L10_OPEN_ISSUE_STATUSES = ["identified", "discussed"] as const;

export const L10_RATING_MIN = 1;
export const L10_RATING_MAX = 10;

/** Column lists the API selects. */
export const L10_COLUMNS = {
  teams:
    "id, department_id, slug, name, meeting_weekday, meeting_time, meeting_timezone, facilitator_id, slack_channel_id, recap_source_team_id, sort_order, is_active",
  members: "id, team_id, profile_id, role",
  rocks: "id, team_id, staff_ministry_id, quarter, title, description, owner_user_id, status, due_on, created_by, created_at, updated_at",
  measurables: "id, team_id, title, owner_id, unit, goal_value, goal_direction, sort_order, is_active, created_by",
  measurable_values: "id, team_id, measurable_id, week_start, value, note, entered_by",
  todos: "id, team_id, title, owner_id, due_on, done, done_at, source_meeting_id, created_by, created_at",
  issues:
    "id, team_id, title, description, owner_id, status, priority, solved_at, source_meeting_id, resolved_meeting_id, created_by, created_at",
  headlines: "id, team_id, department_id, body, author_id, source_meeting_id, is_auto, recap_of_meeting_id, dismissed_at, created_at",
  meetings:
    "id, team_id, department_id, started_at, ended_at, facilitator_id, segment_timings, notes, recap_posted_at, followup_sent_at, created_by",
  attendees: "id, team_id, meeting_id, profile_id, rating, followup_sent_at",
} as const;

/** What a team keeps between meetings. */
export const L10_ITEM_KINDS = ["rocks", "measurables", "measurable_values", "todos", "issues", "headlines"] as const;
export type L10ItemKind = (typeof L10_ITEM_KINDS)[number];

export function isItemKind(value: string): value is L10ItemKind {
  return (L10_ITEM_KINDS as readonly string[]).includes(value);
}
