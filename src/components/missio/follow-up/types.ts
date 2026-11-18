import type { PersonRef } from "../house-churches/types";

export type { PersonRef };

export type VisitType = "first_time" | "been_a_while" | "regular";

export type FollowUpStage = "new" | "contacted" | "visited_house" | "joined";

export type FollowUpSource = "contact" | "connect_response";

export interface FollowUpItem {
  key: string;
  source: FollowUpSource;
  contactId: string | null;
  connectResponseId: string | null;
  followupId: string | null;
  displayName: string;
  phone: string | null;
  email: string | null;
  visitType: VisitType | null;
  wantsHouseChurch: boolean | null;
  wantsPrayer: boolean | null;
  stage: FollowUpStage;
  assignedLeader: PersonRef | null;
  submittedAt: string | null;
}

export interface FollowUpListResponse {
  people: FollowUpItem[];
  canWrite: boolean;
}

export type TimelineKind = "submitted" | "stage_change" | "note";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  fromStage: FollowUpStage | null;
  toStage: FollowUpStage | null;
  body: string | null;
  by: { displayName: string } | null;
  at: string;
}

export interface FollowUpMutation {
  person: FollowUpItem;
  entry: TimelineEntry;
}

export interface TimelineResponse {
  entries: TimelineEntry[];
}

export interface LeaderListResponse {
  leaders: PersonRef[];
}
