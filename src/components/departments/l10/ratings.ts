// Who may set whose meeting rating. Mirrors endMeeting in src/lib/l10/meetings.ts (#741):
// a member rates only themself; a team leader or overseer (`canManage`) or the
// meeting's facilitator may rate any attendee. The server enforces it; the UI
// follows it so a member never sends a rating the server would refuse.

import type { Person, RatingEntry } from "./followup";

export interface RatingRights {
  /** The signed-in viewer. Null means unknown, so nobody can be rated. */
  viewerId: string | null;
  /** access.canManage from l10_can_manage_team (leader or overseer). */
  canManage: boolean;
  /** meeting.facilitator_id. */
  facilitatorId: string | null;
}

/** Leader, overseer or this meeting's facilitator. */
export function canRateOthers(rights: RatingRights): boolean {
  if (!rights.viewerId) return false;
  return rights.canManage || (!!rights.facilitatorId && rights.facilitatorId === rights.viewerId);
}

/** May this viewer set `userId`'s rating? */
export function canRateAttendee(rights: RatingRights, userId: string): boolean {
  if (!rights.viewerId || !userId) return false;
  return userId === rights.viewerId || canRateOthers(rights);
}

/** The rating entries this viewer may send when ending the meeting. */
export function allowedRatingEntries(
  attendees: readonly Person[],
  ratings: Readonly<Record<string, number | null | undefined>>,
  rights: RatingRights
): RatingEntry[] {
  return attendees
    .filter((person) => canRateAttendee(rights, person.id))
    .map((person) => ({ user_id: person.id, rating: ratings[person.id] }));
}
