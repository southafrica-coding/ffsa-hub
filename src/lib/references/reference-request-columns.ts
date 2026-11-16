/**
 * Columns `authenticated` may SELECT on `public.reference_requests`.
 * This list is the GRANT in
 * `supabase/migrations/328_reference_requests_hide_token.sql`.
 * `token` is the referee invite secret and is not here: the public referee
 * form submits whatever pending row that token matches.
 */
export const REFERENCE_REQUEST_COLUMNS = [
  "id",
  "application_id",
  "slot_id",
  "referee_name",
  "referee_email",
  "status",
  "relationship",
  "known_duration",
  "reference_text",
  "form_data",
  "submitted_at",
  "email_sent_at",
  "reminder_sent_at",
  "created_at",
  "updated_at",
] as const;

export const REFERENCE_REQUEST_COLUMN_LIST = REFERENCE_REQUEST_COLUMNS.join(", ");

/** Staff and applicant status views. The slot embed is not the token. */
export const REFERENCE_REQUEST_WITH_SLOT = `${REFERENCE_REQUEST_COLUMN_LIST}, reference_slots(label, description)`;

export const REFERENCE_REQUEST_WITH_SLOT_LABEL = `${REFERENCE_REQUEST_COLUMN_LIST}, reference_slots(label)`;
