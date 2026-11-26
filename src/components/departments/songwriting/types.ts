// Songwriting (Op. Dandelion) UI types.
//
// Nations, trainings and facilitators are the real 417 rows from
// @/lib/departments/db.types. 417 has no leads tables, so Follow-up leads are
// declared here from the songwriting-v1 data-shape note (songwriting_leads /
// songwriting_lead_events). They are UI-only until a backend PR adds them.

import type { PwNation, PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";

export type { PwNation, PwSongwritingTraining, PwTrainingFacilitator };

export const LEAD_KINDS = ["person", "organisation", "group"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export const LEAD_STATUSES = ["new", "to_contact", "waiting", "connected", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Proposed songwriting_leads row. Contact details belong in the CRM, not here. */
export interface SongwritingLead {
  id: string;
  label: string;
  kind: LeadKind;
  contact_user_id: string | null;
  source_training_id: string | null;
  nation_id: string | null;
  note: string | null;
  owner_user_id: string | null;
  /** Resolved by the API. Null = unassigned. */
  owner_name: string | null;
  status: LeadStatus;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Proposed songwriting_lead_events row ("Log contact"). */
export interface SongwritingLeadEvent {
  id: string;
  lead_id: string;
  at: string;
  by: string | null;
  note: string | null;
}

/** Everything the Songwriting pages read, in one payload. */
export interface SongwritingData {
  nations: PwNation[];
  trainings: PwSongwritingTraining[];
  facilitators: PwTrainingFacilitator[];
  leads: SongwritingLead[];
  /** Song Library songs (not pw_songs). 0 at launch. */
  librarySongCount: number;
  /** Song Library songs per source training id. */
  librarySongsByTraining: Record<string, number>;
}

export const EMPTY_SONGWRITING: SongwritingData = {
  nations: [],
  trainings: [],
  facilitators: [],
  leads: [],
  librarySongCount: 0,
  librarySongsByTraining: {},
};

/** What the training form sends. The optional day is not stored (417 has no date column). */
export interface TrainingInput {
  audience_label: string;
  year: number;
  month: number;
  location_text: string | null;
  nation_id: string | null;
  people_trained: number | null;
  songs_workshop: number | null;
  songs_post: number | null;
  languages: string[];
  notes: string | null;
  status: PwSongwritingTraining["status"];
  facilitators: string[];
}
