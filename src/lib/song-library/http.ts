// Song Library answers: { error } or { error, code }, like the L10 and
// department routes. Clients never see database text.

import { NextResponse } from "next/server";
import { badRequest, notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { SL_CODES } from "./types";

export { badRequest, notAuthorized, notFound, serverError };

export type DbError = { code?: string; message?: string; details?: string } | null | undefined;

export function coded(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

export function conflict(message: string, code?: string) {
  return code ? coded(409, message, code) : NextResponse.json({ error: message }, { status: 409 });
}

export function forbidden(message: string, code: string) {
  return coded(403, message, code);
}

export const splitsLocked = () =>
  coded(409, "Everyone has signed off on the splits, so they are locked. A Song Library manager can revoke the agreement.", SL_CODES.splitsLocked);

/**
 * A PostgREST error as an HTTP answer. 419's named refusals first:
 *   23514 "Credits are agreed …"          → 409 song_splits_locked
 *   23514 "This help request is no longer open" → 409 song_help_closed
 *   23514 "Give this writer a split …"    → 400 song_splits_incomplete
 * Then 42501 (RLS or a 419 trigger) 403, 23503 400, 23505 409, 23514 400,
 * anything else a logged 500.
 */
export function dbError(error: DbError) {
  const msg = error?.message ?? "";
  if (error?.code === "23514" && msg.includes("Credits are agreed")) return splitsLocked();
  if (error?.code === "23514" && msg.includes("no longer open")) return conflict("This help request is no longer open", SL_CODES.helpClosed);
  if (error?.code === "23514" && msg.includes("Give this writer a split")) {
    return coded(400, "Give this writer a split before signing off", SL_CODES.splitsIncomplete);
  }
  switch (error?.code) {
    case "42501":
      return notAuthorized();
    case "23503":
      return badRequest("A linked record does not exist");
    case "23505":
      return conflict("That already exists");
    case "23514":
    case "22P02":
      return badRequest("A value is not allowed");
    default:
      return serverError(error);
  }
}
