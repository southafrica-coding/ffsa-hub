// L10 types for the UI. Row shapes follow Hub Data migration 416 as published
// in PR #739 / included by Hub Backend PR #741 (src/lib/departments/db.types.ts
// and src/lib/l10/types.ts). They are copied here, not imported, so this
// folder builds before those PRs land on feat/departments-services.
//
// Response shapes follow #741's route handlers under
// /api/departments/[slug]/l10/**. api.ts is the only place that reads them.
//
// Auto headlines (is_auto, dismissed_at, recap_of_meeting_id, and
// l10_teams.recap_source_team_id) are in #739's latest 416 types and are
// "coming next" on #741. They are typed here ahead of that landing.

export const L10_SEGMENTS = [
  "segue",
  "scorecard",
  "rock_review",
  "headlines",
  "todo_list",
  "ids",
  "conclude",
] as const;
export type L10Segment = (typeof L10_SEGMENTS)[number];

export const L10_ITEM_KINDS = [
  "rocks",
  "measurables",
  "measurable_values",
  "todos",
  "issues",
  "headlines",
] as const;
export type L10ItemKind = (typeof L10_ITEM_KINDS)[number];

export type L10TeamRole = "member" | "leader";
export type L10IssueStatus = "identified" | "discussed" | "solved";
export type L10MeasurableUnit = "number" | "percent" | "currency" | "yes_no";
export type L10GoalDirection = "at_least" | "at_most" | "exactly";
export type L10RockStatus = "on_track" | "off_track" | "done";

export interface L10SegmentTiming {
  started_at?: string | null;
  ended_at?: string | null;
}
export type L10SegmentTimings = Partial<Record<L10Segment, L10SegmentTiming>>;

export interface L10Team {
  id: string;
  department_id: string;
  slug: string;
  name: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  meeting_weekday: number | null;
  /** 'HH:MM:SS' local time in meeting_timezone. */
  meeting_time: string | null;
  meeting_timezone: string;
  facilitator_id: string | null;
  slack_channel_id: string | null;
  /**
   * Paired team in the same department whose latest ended meeting is recapped
   * as an auto headline when this team's meeting starts. From #739; not yet
   * in #741's column list.
   */
  recap_source_team_id?: string | null;
  sort_order: number;
  is_active: boolean;
  my_role?: L10TeamRole | null;
}

/** A users row as #741 attaches it to a member. */
export interface L10PersonName {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}

/** A roster row. profile_id is users.id. `user` is what #741 returns. */
export interface L10Member {
  id?: string;
  team_id?: string;
  profile_id: string;
  role: L10TeamRole;
  user?: L10PersonName | null;
  /** Filled by the client from `user` when the API does not send a name. */
  name?: string | null;
}

export interface L10Meeting {
  id: string;
  team_id: string;
  started_at: string;
  ended_at: string | null;
  facilitator_id: string | null;
  segment_timings: L10SegmentTimings;
  notes?: string | null;
  recap_posted_at?: string | null;
  followup_sent_at?: string | null;
  created_by?: string | null;
  /** Derived by #741 from segment_timings on every meeting response. */
  current_segment?: L10Segment | null;
}

export interface L10Attendee {
  id?: string;
  team_id?: string;
  meeting_id?: string;
  profile_id: string;
  name?: string | null;
  user?: L10PersonName | null;
  rating: number | null;
  followup_sent_at?: string | null;
}

export interface L10Measurable {
  id: string;
  title: string;
  owner_id: string | null;
  unit: L10MeasurableUnit;
  goal_value: number | null;
  goal_direction: L10GoalDirection;
  sort_order: number;
  is_active: boolean;
}

export interface L10MeasurableValue {
  id?: string;
  team_id?: string;
  measurable_id: string;
  /** 'YYYY-MM-DD', always a Monday. */
  week_start: string;
  /** Null = not entered. yes_no stores 1 or 0. */
  value: number | null;
  note?: string | null;
  entered_by?: string | null;
}

export interface L10Todo {
  id: string;
  title: string;
  owner_id: string | null;
  due_on: string | null;
  done: boolean;
  done_at: string | null;
  source_meeting_id: string | null;
  created_at: string;
}

export interface L10Issue {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  status: L10IssueStatus;
  /** 1–3 top-three rank, null = unranked. */
  priority: number | null;
  solved_at: string | null;
  source_meeting_id: string | null;
  resolved_meeting_id: string | null;
  created_at: string;
}

/**
 * l10_headlines. body is the #741 field (there is no title/kind).
 * is_auto, recap_of_meeting_id and dismissed_at are in #739 and coming on #741.
 */
export interface L10Headline {
  id: string;
  team_id?: string;
  body: string;
  author_id: string | null;
  source_meeting_id: string | null;
  created_at: string;
  updated_at?: string;
  /** System cross-team recap. Cannot be edited or deleted by a member. */
  is_auto?: boolean;
  /** The paired team's ended meeting this auto row recaps. */
  recap_of_meeting_id?: string | null;
  /** Null = showing. Any team member may set it. */
  dismissed_at?: string | null;
  /** Optional until the API includes the paired team's name on the row. */
  recap_source_team_name?: string | null;
}

/** A public.rocks row with team_id set. owner_user_id is the #741 column. */
export interface L10Rock {
  id: string;
  title: string;
  owner_user_id: string | null;
  status: L10RockStatus;
  due_on: string | null;
  quarter: string;
}

export interface L10Access {
  canEdit?: boolean;
  canManage?: boolean;
}

/** #741 live_meeting: the running meeting, its attendees, and its headlines. */
export interface L10LiveMeeting {
  meeting: L10Meeting;
  attendees: L10Attendee[];
  headlines: L10Headline[];
}

// ── Responses (#741) ──────────────────────────────────────────────────

export interface L10TeamsResponse {
  department?: { id?: string; slug: string; name?: string };
  teams: L10Team[];
}

export interface L10TeamDetail {
  team: L10Team;
  my_role?: L10TeamRole | null;
  access?: L10Access;
  quarter?: string;
  members: L10Member[];
  rocks: L10Rock[];
  measurables: L10Measurable[];
  measurable_values: L10MeasurableValue[];
  todos: L10Todo[];
  issues: L10Issue[];
  /**
   * Not on GET /teams/:id in #741 (only live_meeting.headlines is).
   * The client loads GET .../headlines and fills this in.
   */
  headlines: L10Headline[];
  live_meeting: L10LiveMeeting | null;
  recent_meetings?: L10Meeting[];
}

export interface L10MeetingDetail {
  meeting: L10Meeting;
  attendees: L10Attendee[];
  average_rating?: number | null;
}

/** Per-person DM outcome after End. */
export interface L10FollowupResult {
  user_id: string;
  outcome: string;
}

export interface L10EndResponse {
  meeting?: L10Meeting;
  already_ended?: boolean;
  followup?: { results?: L10FollowupResult[] } | null;
  recap?: { outcome?: string } | null;
}

// ── Inputs ────────────────────────────────────────────────────────────

export interface NewTodoInput {
  title: string;
  owner_id: string | null;
  due_on: string | null;
  source_meeting_id?: string | null;
}

export interface NewIssueInput {
  title: string;
  owner_id?: string | null;
  source_meeting_id?: string | null;
}

export interface NewHeadlineInput {
  body: string;
  author_id?: string | null;
  source_meeting_id?: string | null;
}

export interface NewMeasurableValueInput {
  measurable_id: string;
  week_start: string;
  value?: number | null;
  note?: string | null;
}

export interface IssuePatch {
  status?: L10IssueStatus;
  priority?: number | null;
  resolved_meeting_id?: string | null;
}

/** Backend's End body. See followup.ts. */
export interface EndMeetingPayload {
  ratings: { user_id: string; rating: number }[];
}
