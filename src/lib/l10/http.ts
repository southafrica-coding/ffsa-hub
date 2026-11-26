import { NextResponse } from "next/server";
import { badRequest, notAuthorized, notFound, serverError } from "@/lib/departments/http";

export { badRequest, notAuthorized, notFound, serverError };

export function conflict(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 409 });
}

import { isRaised, isUniqueClash, type DbError } from "./db-errors";
import {
  L10_ATTENDEE_IMMUTABLE,
  L10_AUTO_HEADLINE_INCOMPLETE,
  L10_AUTO_HEADLINE_LOCKED,
  L10_MEETING_ALREADY_OPEN,
  L10_ONE_AUTO_RECAP_INDEX,
  L10_ONE_OPEN_MEETING_INDEX,
  L10_RATING_NOT_ALLOWED,
} from "./types";

/** An error answer with a machine-readable code. */
export function coded(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

/**
 * A PostgREST error as an HTTP answer. 416's named errors first, each with
 * its code: l10_rating_not_allowed (42501 → 403), l10_attendee_immutable
 * (42501 → 403), l10_auto_headline_locked
 * (42501 → 409), l10_auto_headline_incomplete (23514 → 500, a Hub bug, logged),
 * l10_meetings_one_open_per_team (23505 → 409 l10_meeting_already_open) and
 * l10_headlines_one_auto_recap (23505 → 409). Then: RLS refusals (42501) are
 * 403, broken references (23503) are 400, other unique clashes (23505) 409,
 * check failures (23514) 400. Anything else is a logged 500 with no database
 * text in the body.
 */
export function dbError(error: DbError) {
  if (isRaised(error, "42501", L10_RATING_NOT_ALLOWED)) {
    return coded(403, "You can only set your own rating", L10_RATING_NOT_ALLOWED);
  }
  if (isRaised(error, "42501", L10_ATTENDEE_IMMUTABLE)) {
    return coded(403, "An attendee's meeting, person and team cannot be changed. Remove them and add them again.", L10_ATTENDEE_IMMUTABLE);
  }
  if (isRaised(error, "42501", L10_AUTO_HEADLINE_LOCKED)) {
    return coded(409, "This headline was written by the Hub. Dismiss it instead of editing or deleting it.", L10_AUTO_HEADLINE_LOCKED);
  }
  if (isRaised(error, "23514", L10_AUTO_HEADLINE_INCOMPLETE)) {
    console.error("[l10] auto headline written without both meeting ids", error);
    return coded(500, "Something went wrong", L10_AUTO_HEADLINE_INCOMPLETE);
  }
  if (isUniqueClash(error, L10_ONE_OPEN_MEETING_INDEX)) {
    return coded(409, "This team already has a meeting running", L10_MEETING_ALREADY_OPEN);
  }
  if (isUniqueClash(error, L10_ONE_AUTO_RECAP_INDEX)) {
    return coded(409, "This meeting already has that recap", L10_ONE_AUTO_RECAP_INDEX);
  }
  switch (error?.code) {
    case "42501":
      return notAuthorized();
    case "23503":
      return badRequest("A linked record does not exist");
    case "23505":
      return conflict("That already exists");
    case "23514":
      return badRequest("A value is not allowed");
    default:
      return serverError(error);
  }
}
