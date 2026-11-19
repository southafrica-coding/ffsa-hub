/**
 * UI-side view of `/api/missio/house-churches`.
 *
 * Shapes follow Hub Backend draft #616 (`cursor/missio-house-churches-backend-d64c`),
 * especially `ImportReviewItem`: `sourceLine` is a number, `kind` and `matchType`
 * are `string | null`, and `note` is the parser annotation. This file is not
 * a copy of `src/lib/missio/types.ts`.
 */

export type HouseCampus = "potch" | "jhb";

export type HouseRole = "leader" | "co_leader" | "member";

/** A contact. `orgPersonId` is set only when they have a Missio people row. */
export interface PersonRef {
  contactId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  orgPersonId?: string;
  /** Masked email and phone. Only on review-queue matches from outside Missio. */
  hint?: string;
}

/** One row of the review queue's search across every contact. */
export interface ReviewContactMatch extends PersonRef {
  inMissio: boolean;
}

export interface ReviewContactSearchResponse {
  matches: ReviewContactMatch[];
}

export interface HouseSummary {
  id: string;
  number: number;
  name: string | null;
  campus: HouseCampus;
  meetingDay: string | null;
  location: string | null;
  /** Includes leaders and co-leaders. */
  memberCount: number;
  leaders: PersonRef[];
  coLeaders: PersonRef[];
  /** Pastoral covering for the leaders. A house can have several. */
  coaches: CoachRef[];
}

export type CoachRef = PersonRef & { since: string | null };

export interface CoachResponse {
  coaches: CoachRef[];
}

export interface HouseMember extends PersonRef {
  role: HouseRole;
  startedAt: string | null;
}

export interface HouseDetail extends HouseSummary {
  leaderNotes: string | null;
  members: HouseMember[];
}

/** What the viewer may do. Pastors: both. Coaches: editMembers in houses they coach. */
export interface HouseAbilities {
  place: boolean;
  editMembers: boolean;
}

export interface HouseListResponse {
  houses: HouseSummary[];
  /** Pastor actions: add people, set coaches, review names. */
  canWrite: boolean;
  abilities?: HouseAbilities;
}

export interface HouseDetailResponse {
  house: HouseDetail;
  canWrite: boolean;
  abilities?: HouseAbilities;
}

export interface MemberMutationResponse {
  member: HouseMember;
}

export type ReviewStatus = "pending" | "matched" | "new" | "skipped";

export interface ReviewHouseRef {
  id: string;
  number: number;
  name: string | null;
}

export interface ReviewItem {
  id: string;
  status: ReviewStatus;
  /** Sheet line number. Null only when the payload omitted a usable number. */
  sourceLine: number | null;
  rawName: string;
  /** Known values include person, couple_split, family_label, and first_only. */
  kind: string | null;
  matchType: string | null;
  houseNumber: number;
  house: ReviewHouseRef | null;
  role: HouseRole | null;
  /** Up to five possible people. May be empty. */
  candidates: PersonRef[];
  /** Parser annotation from the JSON field `note`, for example "see house 4". */
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReviewListResponse {
  items: ReviewItem[];
}

export type ResolveBody =
  | { action: "link"; contactId: string; also?: true; rename?: { firstName: string; lastName?: string } }
  | {
      action: "create";
      firstName: string;
      lastName?: string;
      email?: string;
      phone?: string;
      also?: true;
      allowDuplicate?: true;
    }
  | { action: "skip"; notes?: string };

/** Link and create add the person to the house. Skip does not. */
export interface ResolvedMember {
  contactId: string;
  role: HouseRole;
}

export interface ResolveResponse {
  item: ReviewItem;
  member?: ResolvedMember;
}

export type HouseErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_missio_person"
  | "not_found"
  | "already_member"
  | "already_resolved"
  | "membership_not_current"
  | "member_left_missio"
  | "ended_at_in_future"
  | "rate_limited"
  | "server_error";
