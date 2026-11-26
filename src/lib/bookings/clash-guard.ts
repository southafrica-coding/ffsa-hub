// The server side of "no two live bookings on one space at once". Every route
// that writes a space booking checks here first so it can answer with who
// holds the space, and the database (migration 403) refuses the write anyway
// if two requests race. A space manager or admin can book over a clash with a
// reason; the trigger stamps and audits it.

import { NextResponse } from "next/server";
import { getVenueBookingsBetween, type BookingAccess } from "@/services/bookings";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import {
  blockLead,
  describeConflict,
  type Conflict,
  type ExistingRow,
} from "@/lib/bookings/conflict-messages";
import { OVERRIDE_REASON_MAX } from "@/lib/bookings/override";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export { OVERRIDE_REASON_MAX };

/** Book over a clash: admins and bookings.manage only. bookings.approve alone
 *  decides requests, it doesn't override the calendar (see migration 403). */
export function canOverrideClash(access: Pick<BookingAccess, "isAdmin" | "canManage">): boolean {
  return access.isAdmin || access.canManage;
}

/** Today in South Africa, YYYY-MM-DD. Booking dates are SAST wall-clock. */
export function todaySAST(now: Date = new Date()): string {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type ClashCandidate = Pick<
  BookingWindow,
  "booking_date" | "end_date" | "setup_time" | "start_time" | "end_time" | "setdown_time"
> & { id?: string };

/**
 * Live bookings on a space that would clash with any of the candidates.
 * Each candidate skips itself (by id); `excludeIds` / `excludeSeriesId` skip
 * rows that move together with the candidates.
 */
export async function findVenueClashes(
  supabase: Client,
  venueId: string,
  candidates: ClashCandidate[],
  opts: { excludeIds?: Iterable<string>; excludeSeriesId?: string } = {}
): Promise<Conflict[]> {
  if (candidates.length === 0) return [];
  const days = candidates
    .flatMap((c) => [c.booking_date, c.end_date ?? c.booking_date])
    .sort();
  const { data } = await getVenueBookingsBetween(supabase, venueId, days[0], days[days.length - 1]);
  const skip = new Set(opts.excludeIds ?? []);
  const existing = ((data ?? []) as ExistingRow[]).filter(
    (row) => !skip.has(row.id) && !(opts.excludeSeriesId && row.series_id === opts.excludeSeriesId)
  );
  const conflicts: Conflict[] = [];
  for (const c of candidates) {
    const candidate: BookingWindow = {
      id: c.id ?? "",
      venue_id: venueId,
      booking_date: c.booking_date,
      end_date: c.end_date,
      setup_time: c.setup_time,
      start_time: c.start_time,
      end_time: c.end_time,
      setdown_time: c.setdown_time,
      status: "pending",
    };
    for (const hit of findConflicts(candidate, existing)) {
      conflicts.push(describeConflict(c.booking_date, hit as ExistingRow));
    }
  }
  return conflicts;
}

/** The 409 every space-booking write answers a clash with. */
export function clashResponse(
  conflicts: Conflict[],
  venueName: string | null | undefined,
  canOverride: boolean
): NextResponse {
  return NextResponse.json(
    { error: blockLead(conflicts, venueName), conflicts, blocked: true, canOverride },
    { status: 409 }
  );
}

/**
 * Read { override: { reason } } from a request body. No override → reason null.
 * Not allowed → 403; blank or too long → 400.
 */
export function parseOverride(
  body: Record<string, unknown> | { override?: unknown },
  access: Pick<BookingAccess, "isAdmin" | "canManage">
): { reason: string | null } | { response: NextResponse } {
  const requested = (body as { override?: unknown }).override;
  if (requested === undefined || requested === null) return { reason: null };
  if (!canOverrideClash(access)) {
    return {
      response: NextResponse.json(
        { error: "Only a space manager can book over a clash." },
        { status: 403 }
      ),
    };
  }
  const raw = typeof requested === "object" ? (requested as { reason?: unknown }).reason : null;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) {
    return {
      response: NextResponse.json(
        { error: "Say why this booking needs to go ahead over the clash." },
        { status: 400 }
      ),
    };
  }
  if (reason.length > OVERRIDE_REASON_MAX) {
    return {
      response: NextResponse.json(
        { error: `Keep the reason to ${OVERRIDE_REASON_MAX} characters or fewer.` },
        { status: 400 }
      ),
    };
  }
  return { reason };
}

type DbError = { code?: string; message?: string } | null | undefined;

export function isClashError(error: DbError): boolean {
  return error?.code === "23P01";
}

/**
 * Turn the guard's refusals into the API's answers, never its raw text:
 * a clash → 409 (with the clashes re-read), an override by the wrong person
 * → 403, an over-long reason → 400. Anything else → null, for the caller's
 * usual handling.
 */
export async function clashErrorResponse(
  error: DbError,
  ctx: {
    recheck: () => Promise<Conflict[]>;
    venueName: string | null | undefined;
    canOverride: boolean;
  }
): Promise<NextResponse | null> {
  if (!error) return null;
  if (isClashError(error)) {
    let conflicts: Conflict[] = [];
    try {
      conflicts = await ctx.recheck();
    } catch {
      conflicts = [];
    }
    return clashResponse(conflicts, ctx.venueName, ctx.canOverride);
  }
  if (error.code === "42501" && error.message?.includes("venue_booking_override_forbidden")) {
    return NextResponse.json({ error: "Only a space manager can book over a clash." }, { status: 403 });
  }
  if (error.code === "23514" && error.message?.includes("venue_booking_override_reason_too_long")) {
    return NextResponse.json(
      { error: `Keep the reason to ${OVERRIDE_REASON_MAX} characters or fewer.` },
      { status: 400 }
    );
  }
  return null;
}

/**
 * A 500 the client can safely see: the real error goes to the server log,
 * the response carries only `message`.
 */
export function serverError(where: string, error: unknown, message: string): NextResponse {
  console.error(`[bookings] ${where}`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
