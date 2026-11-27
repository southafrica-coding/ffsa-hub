// Request bodies for the Songwriting API (#756). Every body is built from
// an explicit list of writable keys, so a record read from the API (which
// carries created_by, by, last_contact_at, owner_name, …) can be passed in
// and nothing 424 owns is ever sent back. The API refuses those keys with
// 400 read_only_field.

import type { ContactInput, LeadInput, NationInput, TrainingInput } from "./types";

/** Keys 424 (and the API) own. Never in a request body. */
export const READ_ONLY_KEYS = ["created_by", "by", "last_contact_at"] as const;

const TRAINING_KEYS = [
  "audience_label",
  "year",
  "month",
  "training_date",
  "location_text",
  "nation_id",
  "people_trained",
  "songs_workshop",
  "songs_post",
  "languages",
  "notes",
  "status",
  "facilitators",
] as const satisfies readonly (keyof TrainingInput)[];

const NATION_KEYS = ["name", "slug", "continent", "status", "notes", "iso_code", "languages"] as const satisfies readonly (keyof NationInput)[];

const LEAD_KEYS = [
  "label",
  "kind",
  "contact_user_id",
  "source_training_id",
  "nation_id",
  "note",
  "owner_user_id",
  "status",
] as const satisfies readonly (keyof LeadInput)[];

const CONTACT_KEYS = ["note", "at"] as const satisfies readonly (keyof ContactInput)[];

function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const from = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (from[key] !== undefined) out[key] = from[key];
  return out;
}

/** POST / PATCH body for a training. training_date is always present (a date or null). */
export function trainingPayload(input: TrainingInput): Record<string, unknown> {
  return { ...pick(input, TRAINING_KEYS), training_date: input.training_date ?? null };
}

export function nationPayload(input: NationInput): Record<string, unknown> {
  return pick(input, NATION_KEYS);
}

export function leadPayload(input: LeadInput): Record<string, unknown> {
  return pick(input, LEAD_KEYS);
}

export function contactPayload(input: ContactInput): Record<string, unknown> {
  return pick(input, CONTACT_KEYS);
}
