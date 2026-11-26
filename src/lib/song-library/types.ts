// Song Library (migration 419): the table names, column lists and error
// codes the server uses. Row types and enums live in ./db.types (Hub Data's
// file for 419); this file only adds what the API needs on top.

import { SONG_EARLY_STAGES, SONG_STAGES, type SongStage } from "./db.types";

export * from "./db.types";

export const SL_TABLES = {
  songs: "song_library_songs",
  versions: "song_library_versions",
  events: "song_library_stage_events",
  celebrate: "song_library_celebrate_notes",
  writers: "song_library_writers",
  publishing: "song_library_publishing",
  checkpoints: "song_library_checkpoints",
  helpers: "song_library_helpers",
  helpRequests: "song_library_help_requests",
  helpSignups: "song_library_help_signups",
  subscriptions: "song_library_subscriptions",
  notifications: "song_library_notifications",
  status: "song_library_song_status",
  refine: "song_library_refine_items",
  pathway: "song_library_pathway_steps",
  share: "song_library_share_steps",
} as const;

export const SL_COLUMNS = {
  songs:
    "id, title, created_by, entry_point, pathway, holy_spirit_interrupt, stage, placement, music_key, bpm, lyrics_md, chart_path, current_version_id, visibility, source_training_id, last_activity_at, created_at, updated_at",
  versions: "id, song_id, n, label, storage_path, mime_type, size_bytes, duration_s, is_demo, isrc, uploaded_by, uploaded_at, updated_at",
  events: "id, song_id, kind, from_stage, to_stage, payload, by_user, at, note",
  writers: "id, song_id, user_id, display_name, role, is_lead, split_pct, added_by, confirmed_at, confirmed_by, created_at, updated_at",
  publishing: "song_id, ccli_no, publisher, pro_by_writer, notes, updated_by, created_at, updated_at",
  celebrate: "song_id, prompt_no, body, by_user, created_at, updated_at",
  helpRequests: "id, song_id, asked_by, categories, body, status, helper_user_id, closed_at, created_at, updated_at",
  helpSignups: "id, request_id, user_id, note, created_at, updated_at",
  helpers: "user_id, category, note, created_at",
  subscriptions: "id, user_id, target_type, target_user_id, created_at",
  status:
    "song_id, stage, placement, last_activity_at, stuck_days, stuck_after_days, is_stuck, is_finished, needs_demo, splits_agreed, splits_total_pct, writers_count, writers_confirmed",
  checkpoints: "song_id, kind, done_at, by_user, note, created_at, updated_at",
  refine: "song_id, q_no, checked, note, by_user, at",
  pathway: "song_id, step, done_at, by_user",
  share: "song_id, kind, done_at, by_user",
  people: "id, first_name, last_name, preferred_name",
} as const;

/**
 * Error codes the API answers with ({ error, code }). The first block is
 * Hub UI's vocabulary (#745 client.ts errorCopy); `reason` values on a 403
 * say which rule refused.
 */
export const SL_CODES = {
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  notFound: "not_found",
  invalidInput: "invalid_input",
  checkFailed: "check_failed",
  duplicate: "duplicate",
  splitsIncomplete: "splits_not_100",
  creditsAgreed: "credits_agreed",
  stageNotAllowed: "stage_not_allowed",
  tooLarge: "too_large",
  // Ours (Hub UI falls back to its default copy until it adds these).
  moved: "song_moved",
  helpClosed: "help_closed",
  uploadMissing: "upload_missing",
  useSignedUpload: "use_signed_upload",
} as const;

/** `reason` on a 403 forbidden. */
export const SL_REASONS = {
  stageNotAllowed: "stage_not_allowed",
  placementNotAllowed: "placement_not_allowed",
  notWriter: "not_writer",
  notLead: "not_lead_writer",
  notManager: "not_manager",
  publishingNotAllowed: "publishing_not_allowed",
  confirmNotAllowed: "confirm_not_allowed",
  celebrateHidden: "celebrate_hidden",
  creditsDerived: "credits_follow_confirmations",
} as const;

export function isStage(v: unknown): v is SongStage {
  return typeof v === "string" && (SONG_STAGES as readonly string[]).includes(v);
}

/** 419's early stages (song_library_songs_guard v_early). */
export function isEarlyStage(v: SongStage): boolean {
  return (SONG_EARLY_STAGES as readonly string[]).includes(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Client = any;
export type Row = Record<string, unknown>;
