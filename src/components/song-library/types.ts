// Song Library UI types.
//
// These mirror the draft #743 contract (migration 419,
// src/lib/song-library/db.types.ts on that branch). That PR is not merged,
// so the shapes are re-declared here for the UI only. When #743 lands,
// replace these with imports from "@/lib/song-library/db.types" and delete
// the duplicates. Names and enum values match 419 exactly.

/** Stages in board order. Finished = demo_ready or later. */
export const SONG_STAGES = [
  "idea_entry",
  "writing",
  "set_down",
  "refine",
  "written_needs_demo",
  "demo_ready",
  "share",
  "celebrate",
] as const;
export type SongStage = (typeof SONG_STAGES)[number];

export const FINISHED_STAGES = ["demo_ready", "share", "celebrate"] as const satisfies readonly SongStage[];

/** personal = Personal (Devo/Balladeers). */
export const SONG_PLACEMENTS = ["inbox", "prayer_sets", "ministry_nights", "events", "ffsa_music", "personal"] as const;
export type SongPlacement = (typeof SONG_PLACEMENTS)[number];

export const SONG_ENTRY_POINTS = ["lyric", "melody", "instrumental"] as const;
export type SongEntryPoint = (typeof SONG_ENTRY_POINTS)[number];
export type SongPathwayStep = SongEntryPoint;

export const SONG_PATHWAYS = ["b1", "b2"] as const;
export type SongPathway = (typeof SONG_PATHWAYS)[number];

export const SONG_EVENT_KINDS = ["stage", "placement", "checkpoint", "version", "writer"] as const;
export type SongEventKind = (typeof SONG_EVENT_KINDS)[number];

export const SONG_CHECKPOINT_KINDS = [
  "credits_splits_agreed",
  "prayer_room_test",
  "ministry_night_debut",
  "event",
  "recording",
] as const;
export type SongCheckpointKind = (typeof SONG_CHECKPOINT_KINDS)[number];

export const SONG_HELP_CATEGORIES = [
  "vocals",
  "keys",
  "guitar",
  "bass",
  "drums",
  "demo_production",
  "lyric_feedback",
  "charts",
] as const;
export type SongHelpCategory = (typeof SONG_HELP_CATEGORIES)[number];

export const SONG_HELP_STATUSES = ["open", "filled", "closed"] as const;
export type SongHelpStatus = (typeof SONG_HELP_STATUSES)[number];

export const SONG_SUBSCRIPTION_TARGETS = ["all_uploads", "writer"] as const;
export type SongSubscriptionTarget = (typeof SONG_SUBSCRIPTION_TARGETS)[number];

export const SONG_NOTIFICATION_KINDS = ["new_upload", "stage_moved", "help_asked"] as const;
export type SongNotificationKind = (typeof SONG_NOTIFICATION_KINDS)[number];

/** Refine: 1–10 are the handbook questions, 11 is the bonus. */
export const REFINE_BONUS_Q_NO = 11 as const;

/** song_library_songs. visibility is always 'base'. */
export interface SongLibrarySong {
  id: string;
  title: string;
  created_by: string | null;
  entry_point: SongEntryPoint;
  pathway: SongPathway | null;
  holy_spirit_interrupt: boolean;
  stage: SongStage;
  placement: SongPlacement;
  music_key: string | null;
  bpm: number | null;
  lyrics_md: string | null;
  chart_path: string | null;
  current_version_id: string | null;
  visibility: "base";
  /** pw_songwriting_trainings.id (417). */
  source_training_id: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

/** What the upload form sends. stage / placement are never sent from here. */
export type SongLibrarySongInsert = Pick<SongLibrarySong, "title" | "entry_point"> &
  Partial<Pick<SongLibrarySong, "pathway" | "holy_spirit_interrupt" | "lyrics_md" | "source_training_id">>;

export interface SongLibraryVersion {
  id: string;
  song_id: string;
  n: number;
  label: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_s: number | null;
  is_demo: boolean;
  isrc: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface SongLibraryPathwayStep {
  song_id: string;
  step: SongPathwayStep;
  done_at: string;
  by_user: string | null;
}

export interface SongLibraryStageEvent {
  id: string;
  song_id: string;
  kind: SongEventKind;
  from_stage: SongStage | null;
  to_stage: SongStage | null;
  payload: Record<string, unknown>;
  by_user: string | null;
  at: string;
  note: string | null;
}

export interface SongLibraryRefineItem {
  song_id: string;
  q_no: number;
  checked: boolean;
  note: string | null;
  by_user: string | null;
  at: string;
}

export interface SongLibraryWriter {
  id: string;
  song_id: string;
  user_id: string | null;
  display_name: string | null;
  role: string | null;
  is_lead: boolean;
  split_pct: number | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongLibraryProEntry {
  pro?: string | null;
  member_no?: string | null;
}

export interface SongLibraryPublishing {
  song_id: string;
  ccli_no: string | null;
  publisher: string | null;
  pro_by_writer: Record<string, SongLibraryProEntry>;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongLibraryCheckpoint {
  song_id: string;
  kind: SongCheckpointKind;
  done_at: string | null;
  by_user: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongLibraryHelper {
  user_id: string;
  category: SongHelpCategory;
  note: string | null;
  created_at: string;
}

export interface SongLibraryHelpRequest {
  id: string;
  song_id: string;
  asked_by: string | null;
  categories: SongHelpCategory[];
  body: string;
  status: SongHelpStatus;
  helper_user_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongLibrarySubscription {
  id: string;
  user_id: string;
  target_type: SongSubscriptionTarget;
  target_user_id: string | null;
  created_at: string;
}

export interface SongLibraryStageSetting {
  stage: SongStage;
  stuck_after_days: number | null;
  updated_by: string | null;
  updated_at: string;
}

/** song_library_song_status view. */
export interface SongLibrarySongStatus {
  song_id: string;
  stage: SongStage;
  placement: SongPlacement;
  last_activity_at: string;
  stuck_days: number;
  stuck_after_days: number | null;
  is_stuck: boolean;
  is_finished: boolean;
  needs_demo: boolean;
  splits_agreed: boolean;
  splits_total_pct: number;
  writers_count: number;
  writers_confirmed: number;
}

// ── View models the future API returns (names resolved server-side) ──

/** A person as the UI shows them. Never an email or phone. */
export interface SongPerson {
  userId: string | null;
  name: string;
}

/** One row on the library list, writer page, and board. */
export interface SongListItem {
  song: SongLibrarySong;
  writers: SongPerson[];
  status: Pick<SongLibrarySongStatus, "stuck_days" | "is_stuck" | "splits_agreed"> | null;
}

export interface SongDetail {
  song: SongLibrarySong;
  versions: SongLibraryVersion[];
  pathwaySteps: SongLibraryPathwayStep[];
  events: (SongLibraryStageEvent & { byName: string | null })[];
  refine: SongLibraryRefineItem[];
  writers: (SongLibraryWriter & { name: string })[];
  publishing: SongLibraryPublishing | null;
  checkpoints: SongLibraryCheckpoint[];
  helpRequests: (SongLibraryHelpRequest & { askedByName: string | null; helperName: string | null })[];
  status: SongLibrarySongStatus | null;
  /** The viewer is one of this song's writers. */
  viewerIsWriter: boolean;
  /** The viewer follows this song's lead writer. */
  viewerFollowsLead: boolean;
}

export interface WriterProfile {
  person: SongPerson;
  written: SongListItem[];
  coWritten: SongListItem[];
  helpsWith: SongHelpCategory[];
  subscriberCount: number;
  viewerSubscribed: boolean;
  isSelf: boolean;
}

export interface HelpersPage {
  openRequests: (SongLibraryHelpRequest & { songTitle: string; askedByName: string | null })[];
  categoryCounts: Partial<Record<SongHelpCategory, number>>;
  mySignups: SongHelpCategory[];
}

export interface LibraryHome {
  songs: SongListItem[];
  subscribedAllUploads: boolean;
}
