// Songwriting (Op. Dandelion) UI types.
//
// Nations, trainings and facilitators are the 417/424 rows from
// @/lib/departments/db.types. Leads and logged contacts are 424's rows as
// the #756 API answers them (plus owner_name / by_name).
//
// 424 owns created_by, by and last_contact_at: the UI reads them (edit
// gating, "last contact" text) and never writes them. See payloads.ts.

import type { PwNation, PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import type { SongwritingEditRule } from "@/lib/songwriting/access";

export type { PwNation, PwSongwritingTraining, PwTrainingFacilitator };

export const LEAD_KINDS = ["person", "organisation", "group"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export const LEAD_STATUSES = ["new", "to_contact", "waiting", "connected", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** GET /songwriting's viewer block (#756). Edit and delete are gated on this, never on a constant. */
export interface SongwritingViewerOut {
  user_id: string;
  is_admin: boolean;
  is_leader: boolean;
  edit_rule: SongwritingEditRule;
}

/** pw_songwriting_leads as the API answers it. Contact details belong in the CRM, not here. */
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
  /** Read-only: derived from logged contacts (424). Never sent. */
  last_contact_at: string | null;
  /** Read-only: stamped by 424. Read for edit gating, never sent. */
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** pw_songwriting_lead_events as the API answers it ("Log contact"). Append-only. */
export interface SongwritingLeadEvent {
  id: string;
  lead_id: string;
  at: string;
  /** Read-only: stamped by 424. Read for delete gating, never sent. */
  by: string | null;
  /** Resolved by the API. */
  by_name: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything the Songwriting pages read, in one payload (GET /songwriting). */
export interface SongwritingData {
  nations: PwNation[];
  trainings: PwSongwritingTraining[];
  facilitators: PwTrainingFacilitator[];
  leads: SongwritingLead[];
  /** Song Library songs (not pw_songs). 0 at launch. */
  librarySongCount: number;
  /** Song Library songs per source training id. */
  librarySongsByTraining: Record<string, number>;
  /** Who is looking. Null until the API answers: edit actions stay hidden. */
  viewer: SongwritingViewerOut | null;
}

export const EMPTY_SONGWRITING: SongwritingData = {
  nations: [],
  trainings: [],
  facilitators: [],
  leads: [],
  librarySongCount: 0,
  librarySongsByTraining: {},
  viewer: null,
};

/** What the training form sends: #745's TrainingInput plus 424's optional training_date. */
export interface TrainingInput {
  audience_label: string;
  year: number;
  month: number;
  /** YYYY-MM-DD inside year/month, or null for month-only. Always sent, so a month change never leaves it behind. */
  training_date: string | null;
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

/** What the nation form sends (POST / PATCH). */
export interface NationInput {
  name: string;
  /** Omitted on create to let the API derive it from the name. */
  slug?: string;
  continent: PwNation["continent"];
  status: PwNation["status"];
  notes: string | null;
  iso_code: string | null;
  languages: string[];
}

/** What the lead form sends (POST / PATCH). Never created_by or last_contact_at. */
export interface LeadInput {
  label: string;
  kind: LeadKind;
  contact_user_id: string | null;
  source_training_id: string | null;
  nation_id: string | null;
  note: string | null;
  owner_user_id: string | null;
  status: LeadStatus;
}

/** What Log contact sends. Never by. */
export interface ContactInput {
  note: string;
  at?: string;
}
