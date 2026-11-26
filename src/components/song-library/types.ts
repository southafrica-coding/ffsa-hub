// Song Library UI types.
//
// Row/enum shapes are re-exported from the merged #743 module
// (`src/lib/song-library/db.types.ts`). View models below are UI-only.

export {
  SONG_LIBRARY_SERVICE_KEY,
  SONG_LIBRARY_BUCKET,
  SONG_STAGES,
  FINISHED_STAGES,
  SONG_PLACEMENTS,
  SONG_ENTRY_POINTS,
  SONG_PATHWAYS,
  SONG_EVENT_KINDS,
  SONG_SHARE_KINDS,
  SONG_CHECKPOINT_KINDS,
  SONG_HELP_CATEGORIES,
  SONG_HELP_STATUSES,
  SONG_SUBSCRIPTION_TARGETS,
  SONG_NOTIFICATION_KINDS,
  SONG_NOTIFICATION_REASONS,
  REFINE_BONUS_Q_NO,
  SONG_EARLY_STAGES,
} from "@/lib/song-library/db.types";

export type {
  SongStage,
  SongPlacement,
  SongEntryPoint,
  SongPathwayStep,
  SongPathway,
  SongEventKind,
  SongShareKind,
  SongCheckpointKind,
  SongHelpCategory,
  SongHelpStatus,
  SongSubscriptionTarget,
  SongNotificationKind,
  SongNotificationReason,
  SongLibrarySong,
  SongLibrarySongInsert,
  SongLibraryVersion,
  SongLibraryPathwayStep,
  SongLibraryStageEvent,
  SongLibraryRefineItem,
  SongLibraryShareStep,
  SongLibraryCelebrateNote,
  SongLibraryWriter,
  SongLibraryProEntry,
  SongLibraryPublishing,
  SongLibraryCheckpoint,
  SongLibraryHelper,
  SongLibraryHelpRequest,
  SongLibraryHelpSignup,
  SongLibrarySubscription,
  SongLibraryNotification,
  SongLibraryStageSetting,
  SongLibrarySongStatus,
} from "@/lib/song-library/db.types";

import type {
  SongHelpCategory,
  SongLibraryCelebrateNote,
  SongLibraryCheckpoint,
  SongLibraryHelpRequest,
  SongLibraryPathwayStep,
  SongLibraryPublishing,
  SongLibraryRefineItem,
  SongLibrarySong,
  SongLibrarySongStatus,
  SongLibraryStageEvent,
  SongLibraryVersion,
  SongLibraryWriter,
} from "@/lib/song-library/db.types";

// ── View models the future API returns (names resolved server-side) ──

/** A person as the UI shows them. Never an email or phone. */
export interface SongPerson {
  userId: string | null;
  name: string;
}

/** A co-writer on create: Hub users by user_id; a free-text name only for people with no Hub account. */
export type CoWriterInput =
  | { user_id: string; display_name?: string | null; role?: string | null }
  | { user_id?: null; display_name: string; role?: string | null };

/** Permissions on one song, from GET /songs/:id `viewer`. canManage is song_library_can_manage. */
export interface SongViewer {
  isWriter: boolean;
  isLeadWriter?: boolean;
  canManage: boolean;
  canTickRefine: boolean;
  allowedStages?: string[];
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
  /** From the song payload. canManage and canTickRefine are used; other flags are ignored here. */
  viewer?: SongViewer;
  /**
   * GET /api/song-library/songs/:id sends `celebrateNotes` (camelCase), and
   * only when the viewer may read them. Absent otherwise. No celebrate UI
   * is built here; the type matches the song payload. (The dedicated
   * GET /songs/:id/celebrate list uses `celebrate_notes`, unused by this client.)
   */
  celebrateNotes?: SongLibraryCelebrateNote[];
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
