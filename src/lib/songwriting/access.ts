// Who may change a Songwriting record. ONE helper, used by every PATCH and
// DELETE in /api/departments/[slug]/songwriting/**.
//
// Today (rule "rls") it allows exactly what 417/424's RLS allows:
//   * nations, trainings, leads: any active P&W member or admin
//     (pw_can_access_songwriting) may edit or delete;
//   * logged contacts (lead events): append-only; delete only by the
//     person who logged it or an admin (pw_can_delete_lead_event).
//
// Jack is deciding whether edits and deletes should narrow to the record's
// creator, the department's leaders and admins. That is rule
// "creator_leaders_admins" below: flip SONGWRITING_EDIT_RULE and the API
// follows (the database still allows more until a migration narrows RLS).
// Nations have no created_by, so under the narrowed rule only leaders and
// admins could change them.
//
// Pure: no I/O, safe to import from the UI to decide what to show.

export type SongwritingViewer = {
  userId: string;
  /** pw_can_access_songwriting(): active P&W member or admin. */
  canAccess: boolean;
  isAdmin: boolean;
  /** Leader of the owning department (dept_is_ministry_leader). */
  isLeader: boolean;
};

export type SongwritingRecord =
  | { kind: "nation" }
  | { kind: "training"; created_by: string | null }
  | { kind: "lead"; created_by: string | null }
  | { kind: "lead_event"; by: string | null };

export type SongwritingEditRule = "rls" | "creator_leaders_admins";

/** The rule in force. Change this one line when Jack decides. */
export const SONGWRITING_EDIT_RULE: SongwritingEditRule = "rls";

export function canEditSongwritingRecord(
  viewer: SongwritingViewer,
  record: SongwritingRecord,
  rule: SongwritingEditRule = SONGWRITING_EDIT_RULE
): boolean {
  if (!viewer.canAccess) return false;
  // 424: logged contacts are append-only; the author or an admin may delete.
  if (record.kind === "lead_event") return viewer.isAdmin || (record.by !== null && record.by === viewer.userId);
  if (rule === "rls") return true;
  if (viewer.isAdmin || viewer.isLeader) return true;
  if (record.kind === "nation") return false;
  return record.created_by !== null && record.created_by === viewer.userId;
}
