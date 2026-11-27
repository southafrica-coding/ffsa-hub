// Songwriting API answers. Every error is { error, code }, sometimes with
// { fieldErrors: { field: message } } so Hub UI can highlight the field.
// Clients never see database text.
//
// Database errors (lib/l10/db-errors to tell named ones apart):
//   42501 pw_songwriting_actor_locked                → 400 read_only_field (created_by / by are the database's)
//   42501 pw_lead_last_contact_derived               → 400 read_only_field (last_contact_at comes from logged contacts)
//   23514 pw_lead_event_actor_required               → 500, logged (a Hub bug: only service_role can hit it)
//   42501 other (RLS)                                → 403 forbidden
//   23514 pw_songwriting_trainings_date_in_month   → 400 training_date_outside_month
//   23514 other checks (ISO code, languages, …)    → 400 check_failed
//   23505 pw_nations_iso_code_key / slug           → 409 duplicate (fieldErrors iso_code / slug)
//   23505 other                                    → 409 duplicate
//   23503 on a nation delete                       → 409 nation_in_use (handlers check leads/trainings first)
//   23503 other                                    → 400 invalid_input
//   22P02                                          → 400 invalid_input
//   anything else                                  → logged 500

import { NextResponse } from "next/server";
import { serverError } from "@/lib/departments/http";
import { PW_LEAD_EVENT_ACTOR_REQUIRED, PW_LEAD_LAST_CONTACT_DERIVED, PW_SONGWRITING_ACTOR_LOCKED } from "@/lib/departments/db.types";
import { isRaised, isUniqueClash, type DbError } from "@/lib/l10/db-errors";
import { PW_FACILITATOR_NAME_KEY, PW_NATIONS_ISO_CODE_KEY, PW_NATIONS_SLUG_KEY, PW_TRAINING_DATE_IN_MONTH, SW_CODES } from "./types";

export { serverError };
export type { DbError };

export function coded(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

export const notAuthenticated = () => coded(401, "Not authenticated", SW_CODES.unauthenticated);
export const notAuthorized = (message = "Not authorized") => coded(403, message, SW_CODES.forbidden);
export const notFound = (message: string) => coded(404, message, SW_CODES.notFound);

/** 400 invalid_input (or another code), with fieldErrors when a field is named. */
export function invalid(p: { error: string; field?: string; code?: string }) {
  return coded(400, p.error, p.code ?? SW_CODES.invalidInput, p.field ? { fieldErrors: { [p.field]: p.error } } : undefined);
}

export const TRAINING_DATE_MESSAGE = "training_date must fall in the training's year and month. Changing the month? Send a new training_date, or null.";

export function trainingDateOutsideMonth() {
  return invalid({ error: TRAINING_DATE_MESSAGE, field: "training_date", code: SW_CODES.trainingDateOutsideMonth });
}

export function dbError(error: DbError, opts: { nationDelete?: boolean } = {}) {
  if (isRaised(error, "42501", PW_SONGWRITING_ACTOR_LOCKED)) {
    return invalid({ error: "created_by and a logged contact's by are set by the Hub, and logged contacts cannot be edited", field: "created_by", code: SW_CODES.readOnlyField });
  }
  if (isRaised(error, "42501", PW_LEAD_LAST_CONTACT_DERIVED)) {
    return invalid({ error: "last_contact_at comes from logged contacts. Log a contact instead.", field: "last_contact_at", code: SW_CODES.readOnlyField });
  }
  if (isRaised(error, "23514", PW_LEAD_EVENT_ACTOR_REQUIRED)) {
    console.error("[songwriting] lead event written without by", error);
    return serverError();
  }
  if (isRaised(error, "23514", PW_TRAINING_DATE_IN_MONTH)) return trainingDateOutsideMonth();
  if (isUniqueClash(error, PW_NATIONS_ISO_CODE_KEY)) {
    return coded(409, "Another nation already has that ISO code", SW_CODES.duplicate, { fieldErrors: { iso_code: "Another nation already has that ISO code" } });
  }
  if (isUniqueClash(error, PW_NATIONS_SLUG_KEY)) {
    return coded(409, "Another nation already has that slug", SW_CODES.duplicate, { fieldErrors: { slug: "Another nation already has that slug" } });
  }
  if (isUniqueClash(error, PW_FACILITATOR_NAME_KEY)) {
    return coded(409, "That facilitator is already on this training", SW_CODES.duplicate, { fieldErrors: { facilitators: "Listed twice" } });
  }
  switch (error?.code) {
    case "42501":
      return notAuthorized();
    case "23503":
      return opts.nationDelete
        ? coded(409, "This nation is still used by a lead or a training", SW_CODES.nationInUse)
        : coded(400, "A linked record does not exist", SW_CODES.invalidInput);
    case "23505":
      return coded(409, "That already exists", SW_CODES.duplicate);
    case "23514":
      return coded(400, "A value is not allowed", SW_CODES.checkFailed);
    case "22P02":
      return coded(400, "A value is not allowed", SW_CODES.invalidInput);
    default:
      return serverError(error);
  }
}
