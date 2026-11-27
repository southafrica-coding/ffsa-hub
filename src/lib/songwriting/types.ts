// Songwriting department API (417 + 424): tables, columns, codes and the
// shapes the API answers with. The answer shapes match Hub UI's client in
// components/departments/songwriting/types.ts (#745).

import type { PwSongwritingLead, PwSongwritingLeadEvent } from "@/lib/departments/db.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Client = any;
export type Row = Record<string, unknown>;

/**
 * Departments that own a Songwriting area. 417/424 have no department_id
 * (the tables are P&W's), so this is the one place a department is named;
 * the routes are under /api/departments/[slug]/songwriting and any other
 * slug is a 404. Same value as components/departments/songwriting/header.
 */
export const SONGWRITING_DEPARTMENT_SLUGS: readonly string[] = ["prayer_and_worship"];

export const SW_TABLES = {
  nations: "pw_nations",
  trainings: "pw_songwriting_trainings",
  facilitators: "pw_training_facilitators",
  leads: "pw_songwriting_leads",
  events: "pw_songwriting_lead_events",
  librarySongs: "song_library_songs",
} as const;

export const SW_COLUMNS = {
  nations: "id, name, slug, continent, status, notes, iso_code, languages, created_at, updated_at",
  trainings:
    "id, year, month, training_date, location_text, nation_id, audience_label, people_trained, songs_workshop, songs_post, notes, languages, status, source, import_key, created_by, created_at, updated_at",
  facilitators: "id, training_id, person_id, display_name, created_at, updated_at",
  leads:
    "id, label, kind, contact_user_id, source_training_id, nation_id, note, owner_user_id, status, last_contact_at, created_by, created_at, updated_at",
  events: "id, lead_id, at, by, note, created_at, updated_at",
} as const;

/** Display-name columns only: never email or phone. */
export const PERSON_COLUMNS = "id, first_name, last_name, preferred_name";

/** 424's unique index on pw_nations.iso_code (where set). */
export const PW_NATIONS_ISO_CODE_KEY = "pw_nations_iso_code_key";
/** 417's unique constraint on pw_nations.slug. */
export const PW_NATIONS_SLUG_KEY = "pw_nations_slug_key";
/** 417's unique (training_id, display_name). */
export const PW_FACILITATOR_NAME_KEY = "pw_training_facilitators_training_name_key";
/** 424's CHECK that training_date falls in the row's year/month. */
export const PW_TRAINING_DATE_IN_MONTH = "pw_songwriting_trainings_date_in_month";

/**
 * Error codes. The first group is Hub UI's vocabulary (song-library
 * client errorCopy); the rest are ours and fall back to the UI's default copy
 * until it adds words for them.
 */
export const SW_CODES = {
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  notFound: "not_found",
  invalidInput: "invalid_input",
  checkFailed: "check_failed",
  duplicate: "duplicate",
  // Ours.
  trainingDateOutsideMonth: "training_date_outside_month",
  nationHasLeads: "nation_has_leads",
  nationHasTrainings: "nation_has_trainings",
  nationInUse: "nation_in_use",
  readOnlyField: "read_only_field",
} as const;

/** A lead as the API answers it: the 424 row plus owner_name (#745's SongwritingLead). */
export type SongwritingLeadOut = PwSongwritingLead & { owner_name: string | null };

/** A logged contact as the API answers it, plus by_name. */
export type SongwritingLeadEventOut = PwSongwritingLeadEvent & { by_name: string | null };

export type Person = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };

/** preferred_name || first_name, then last_name. Null when nothing is set. */
export function personName(p: Person | undefined | null): string | null {
  if (!p) return null;
  return [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || null;
}
