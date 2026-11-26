// Who may do what in the Song Library (Jack's decisions, 26 Nov 2026).
// Pure rules; the caller passes in who they are and what the song is.
// 419's RLS and triggers say the same thing at the database, except where
// a comment below says the API is stricter.
//
// Roles, all resolved from data, with no department named in code:
//   reader   any active signed-in account (song_library_can_read; the
//            open_to_all use row on the song_library service)
//   manager  song_library_can_manage(): an active member of a ministry
//            holding a manage grant on song_library (today: every P&W member)
//   lead     a leader of a ministry holding an own or manage grant
//            (dept_is_ministry_leader on that ministry), or an admin.
//            The "department leaders and overseers" of the owning department.
//   writer   a song_library_writers row with the caller's user_id on that song
//   admin    song_library_is_admin()

import { isEarlyStage, type SongStage } from "./types";

export type SongLibraryViewer = {
  userId: string;
  isAdmin: boolean;
  /** song_library_can_manage(). */
  canManage: boolean;
  /** Leader of an owning/managing ministry (or admin). */
  isLead: boolean;
};

export type SongRole = { isWriter: boolean; isLeadWriter: boolean };

const manager = (v: SongLibraryViewer) => v.isAdmin || v.canManage;

/**
 * Managers move any stage. A writer moves their own song only between the
 * early stages (419's v_early: idea_entry … written_needs_demo), forwards,
 * backwards or skipping ahead; never into or out of demo_ready, share or
 * celebrate.
 */
export function canMoveStage(v: SongLibraryViewer, r: SongRole, from: SongStage, to: SongStage): boolean {
  if (manager(v)) return true;
  return r.isWriter && isEarlyStage(from) && isEarlyStage(to);
}

/** The stages this caller may move the song to from where it is now. */
export function allowedStages(v: SongLibraryViewer, r: SongRole, from: SongStage, all: readonly SongStage[]): SongStage[] {
  return all.filter((to) => to !== from && canMoveStage(v, r, from, to));
}

/** Placement: managers only (any P&W member). */
export function canSetPlacement(v: SongLibraryViewer): boolean {
  return manager(v);
}

/** Title, lyrics, key, versions, writers, splits, celebrate notes: the song's writers (and admins). */
export function canEditSong(v: SongLibraryViewer, r: SongRole): boolean {
  return v.isAdmin || r.isWriter;
}

/** Deleting a song: its lead writer or an admin (419 policy). */
export function canDeleteSong(v: SongLibraryViewer, r: SongRole): boolean {
  return v.isAdmin || r.isLeadWriter;
}

/**
 * Publishing: the song's writers and the owning department's leaders and
 * overseers. STRICTER than 419, whose policy lets every manager (every P&W
 * member) write publishing.
 */
export function canEditPublishing(v: SongLibraryViewer, r: SongRole): boolean {
  return v.isAdmin || v.isLead || r.isWriter;
}

/** Celebrate notes: read by the song's writers, managers (P&W members) and admins only. */
export function canReadCelebrate(v: SongLibraryViewer, r: SongRole): boolean {
  return manager(v) || r.isWriter;
}

/** Help requests on a song: its writers or managers ask (419 policy). */
export function canAskForHelp(v: SongLibraryViewer, r: SongRole): boolean {
  return manager(v) || r.isWriter;
}

/** Editing or removing a help request: whoever asked, or a manager. */
export function canManageHelpRequest(v: SongLibraryViewer, askedBy: string | null): boolean {
  return manager(v) || (!!askedBy && askedBy === v.userId);
}

/**
 * Signing off a split. A writer with a Hub account signs off only their own
 * row; a writer with no account is signed off by a manager or an admin.
 */
export function canConfirmWriter(v: SongLibraryViewer, writer: { user_id: string | null }): boolean {
  if (writer.user_id) return writer.user_id === v.userId;
  return manager(v);
}

/**
 * Withdrawing a sign-off. Before the splits are agreed: that writer, a
 * manager or an admin (419). Once agreed the splits are locked: only a
 * manager or an admin may revoke the agreement. STRICTER than 419, which
 * also lets the writer themself withdraw (and so unlock).
 */
export function canWithdrawConfirmation(v: SongLibraryViewer, writer: { user_id: string | null }, agreed: boolean): boolean {
  if (manager(v)) return true;
  return !agreed && !!writer.user_id && writer.user_id === v.userId;
}
