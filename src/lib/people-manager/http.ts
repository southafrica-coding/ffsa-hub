// HTTP answers for the People Manager API: { error, code } like lib/l10/http.
// 421 raises named errors (the RAISE message is the code); each comes back
// with its code so Hub UI can show the right words.

import { NextResponse } from "next/server";
import { badRequest, notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { isRaised, type DbError } from "@/lib/l10/db-errors";
import { LEAVE_ERROR_CODES, type LeaveErrorCode } from "./db.types";

export { badRequest, notAuthorized, notFound, serverError };

export function coded(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

/** Status and words for each named 421 error. */
const NAMED: Record<LeaveErrorCode, [number, string]> = {
  leave_request_not_signed_in: [401, "Not authenticated"],
  leave_request_not_requester: [403, "You can only request leave for yourself"],
  leave_request_not_member: [403, "Only active members of this department can request leave here"],
  leave_request_must_start_pending: [400, "A new request starts as pending"],
  leave_request_immutable: [409, "A request's dates, type and details are fixed. Cancel it and make a new one."],
  leave_request_server_only: [403, "Not allowed"],
  leave_request_self_decision: [403, "Nobody decides their own leave"],
  leave_request_not_approver: [403, "Only another leader of this department, or an admin, can decide"],
  leave_request_already_decided: [409, "This request has already been decided"],
  leave_request_locked: [409, "This request can no longer change"],
  leave_request_cancel_not_allowed: [403, "Only the person who asked can cancel"],
  leave_blockout_immutable: [409, "A block-out's owner cannot change"],
  leave_request_type_not_available: [400, "That leave type is not available in this department"],
  leave_request_bad_range: [400, "Those dates and half days do not fit together"],
  leave_request_no_working_days: [400, "Those dates have no working days (weekends and public holidays don't count)"],
  leave_request_decline_note_required: [400, "Say why when declining"],
  leave_days_bad_range: [400, "Those dates and half days do not fit together"],
};

/** The 421 error code inside a PostgREST error, if it is one of ours. */
export function leaveErrorCode(error: DbError): LeaveErrorCode | null {
  for (const [name, sqlstate] of Object.entries(LEAVE_ERROR_CODES) as [LeaveErrorCode, string][]) {
    if (isRaised(error, sqlstate, name)) return name;
  }
  return null;
}

/** A PostgREST error as an answer. Database text never reaches the client. */
export function dbError(error: DbError) {
  const named = leaveErrorCode(error);
  if (named) {
    const [status, words] = NAMED[named];
    return coded(status, words, named);
  }
  switch (error?.code) {
    case "42501":
      return notAuthorized();
    case "23503":
      return badRequest("A linked record does not exist");
    case "23505":
      return coded(409, "That already exists", "conflict");
    case "23514":
      return badRequest("A value is not allowed");
    default:
      return serverError(error);
  }
}
