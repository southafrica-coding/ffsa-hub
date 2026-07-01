/**
 * Domain types for the feedback intake + triage system.
 *
 * The new tables (migration 117) aren't in the generated Supabase
 * `Database` types yet, so these hand-written types are the source of
 * truth for the store layer.
 */

export type IssueType = "bug" | "idea" | "question";
export type IssueSize = "cosmetic" | "small_logic" | "big";
export type IssueLane = "auto_ship" | "build_on_approval" | "product_decision";
export type IssueStatus = "open" | "in_progress" | "shipped" | "dismissed";
export type SessionStatus = "active" | "completed" | "abandoned";

/** A media reference captured from a Slack file share in the DM. */
export type MediaRef = {
  slack_file_id: string;
  name?: string;
  mimetype?: string;
  permalink?: string;
  url_private?: string;
};

/** One turn of the intake DM conversation. */
export type TranscriptTurn = {
  role: "bot" | "user";
  text: string;
  ts?: string;
};

/** Running structured understanding the bot builds up while clarifying. */
export type CollectedInfo = {
  title?: string;
  summary?: string;
  area?: string;
  type?: IssueType;
  expected?: string;
  actual?: string;
};

export type Classification = {
  type: IssueType;
  area: string | null;
  size: IssueSize | null;
  danger_zone: boolean;
  proposed_lane: IssueLane;
  title: string;
  summary: string;
  reason: string;
};

export type HubIssue = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  summary: string;
  area: string | null;
  type: IssueType;
  size: IssueSize | null;
  danger_zone: boolean;
  proposed_lane: IssueLane | null;
  status: IssueStatus;
  reporter_count: number;
  media: MediaRef[];
  triage: Record<string, unknown>;
  triage_channel_ts: string | null;
  resolution: string | null;
};

export type HubIssueReport = {
  id: string;
  created_at: string;
  issue_id: string;
  reporter_slack_id: string;
  reporter_hub_user_id: string | null;
  reporter_name: string | null;
  reporter_email: string | null;
  report_text: string;
  transcript: TranscriptTurn[];
  media: MediaRef[];
};

export type IntakeSession = {
  id: string;
  created_at: string;
  updated_at: string;
  slack_user_id: string;
  dm_channel_id: string;
  status: SessionStatus;
  transcript: TranscriptTurn[];
  collected: CollectedInfo;
  media: MediaRef[];
  last_event_id: string | null;
};
