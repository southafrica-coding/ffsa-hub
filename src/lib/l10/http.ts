import { NextResponse } from "next/server";
import { badRequest, notAuthorized, notFound, serverError } from "@/lib/departments/http";

export { badRequest, notAuthorized, notFound, serverError };

export function conflict(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 409 });
}

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * A PostgREST error as an HTTP answer. RLS refusals (42501) are 403, broken
 * references (23503) are 400, unique clashes (23505) are 409. Anything else
 * is a logged 500 with no database text in the body.
 */
export function dbError(error: DbError) {
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
