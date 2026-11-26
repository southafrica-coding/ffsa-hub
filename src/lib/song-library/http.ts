// Song Library answers. Every error is { error, code } and sometimes
// { fieldErrors } or { reason }. The codes are Hub UI's vocabulary
// (components/song-library/client.ts errorCopy): unauthenticated,
// forbidden, not_found, invalid_input, check_failed, duplicate,
// splits_not_100, credits_agreed, stage_not_allowed, too_large. Plus a few
// of our own (song_moved, help_closed, upload_missing, use_signed_upload).
// Clients never see database text.

import { NextResponse } from "next/server";
import { serverError } from "@/lib/departments/http";
import { SL_CODES } from "./types";

export { serverError };

export type DbError = { code?: string; message?: string; details?: string } | null | undefined;

export function coded(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

export const notAuthenticated = () => coded(401, "Not authenticated", SL_CODES.unauthenticated);
export const notAuthorized = () => coded(403, "Not authorized", SL_CODES.forbidden);
export const notFound = (message: string) => coded(404, message, SL_CODES.notFound);

/** 400 invalid_input. With a field, also { fieldErrors: { [field]: message } }. */
export function badRequest(message: string, field?: string | null) {
  return coded(400, message, SL_CODES.invalidInput, field ? { fieldErrors: { [field]: message } } : undefined);
}

/** A parser's failure: 400 invalid_input, or its own code (413 too_large, 400 splits_not_100). */
export function invalid(p: { error: string; field?: string; code?: string }) {
  if (!p.code) return badRequest(p.error, p.field);
  return coded(p.code === SL_CODES.tooLarge ? 413 : 400, p.error, p.code, p.field ? { fieldErrors: { [p.field]: p.error } } : undefined);
}

export function conflict(message: string, code: string = SL_CODES.duplicate) {
  return coded(409, message, code);
}

/**
 * 403. The code is `forbidden` (or `stage_not_allowed` for a stage move,
 * which Hub UI has its own copy for); `reason` says which rule refused.
 */
export function forbidden(message: string, reason: string) {
  return coded(403, message, reason === SL_CODES.stageNotAllowed ? SL_CODES.stageNotAllowed : SL_CODES.forbidden, { reason });
}

export const splitsLocked = () =>
  coded(409, "Everyone has signed off on the splits, so they are locked. A Song Library manager can revoke the agreement.", SL_CODES.creditsAgreed);

export const tooLarge = () => coded(413, "That file is over 200 MB", SL_CODES.tooLarge);

/**
 * A PostgREST error as an HTTP answer. 419's named refusals first:
 *   23514 "Credits are agreed …"                → 409 credits_agreed
 *   23514 "This help request is no longer open" → 409 help_closed
 *   23514 "Give this writer a split …"          → 400 splits_not_100
 *   23514 "Splits must total 100% …"            → 400 splits_not_100
 * Then 42501 (RLS or a 419 trigger) 403 forbidden, 23503 400
 * invalid_input, 23505 409 duplicate, 23514 400 check_failed, 22P02 400
 * invalid_input, anything else a logged 500.
 */
export function dbError(error: DbError) {
  const msg = error?.message ?? "";
  if (error?.code === "23514" && msg.includes("Credits are agreed")) return splitsLocked();
  if (error?.code === "23514" && msg.includes("no longer open")) return conflict("This help request is no longer open", SL_CODES.helpClosed);
  if (error?.code === "23514" && (msg.includes("Give this writer a split") || msg.includes("Splits must total"))) {
    return coded(400, "Splits must add up to 100% before credits can be agreed", SL_CODES.splitsIncomplete);
  }
  switch (error?.code) {
    case "42501":
      return notAuthorized();
    case "23503":
      return badRequest("A linked record does not exist");
    case "23505":
      return conflict("That already exists");
    case "23514":
      return coded(400, "A value is not allowed", SL_CODES.checkFailed);
    case "22P02":
      return badRequest("A value is not allowed");
    default:
      return serverError(error);
  }
}
