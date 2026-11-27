// What the viewer may change, from the viewer block GET /songwriting
// returns (#756). The rule comes from the API (viewer.edit_rule), never from
// SONGWRITING_EDIT_RULE, so the UI follows when the rule flips. The decision
// itself is the API's own helper, canEditSongwritingRecord.

import { canEditSongwritingRecord, type SongwritingRecord } from "@/lib/songwriting/access";
import type { SongwritingViewerOut } from "./types";

/** False until the API has said who is looking: edit actions stay hidden. */
export function canEdit(viewer: SongwritingViewerOut | null | undefined, record: SongwritingRecord): boolean {
  if (!viewer) return false;
  return canEditSongwritingRecord(
    // GET /songwriting only answers active P&W members and admins.
    { userId: viewer.user_id, canAccess: true, isAdmin: viewer.is_admin, isLeader: viewer.is_leader },
    record,
    viewer.edit_rule
  );
}

/** The band under the Songwriting tabs. Follows viewer.edit_rule. */
export function editBandCopy(viewer: SongwritingViewerOut | null | undefined, departmentName: string): string {
  if (!viewer) return `Anyone in ${departmentName} can add.`;
  if (viewer.edit_rule === "rls") return `Anyone in ${departmentName} can add and edit.`;
  return `Anyone in ${departmentName} can add. Whoever added a record, the department's leaders and admins can edit it.`;
}

/** Read-only note on an edit screen the viewer may not change. */
export function cannotEditCopy(thing: "training" | "lead" | "nation"): string {
  return thing === "nation"
    ? "Only the department's leaders and admins can change nations."
    : `Only whoever added this ${thing}, the department's leaders and admins can change it.`;
}
