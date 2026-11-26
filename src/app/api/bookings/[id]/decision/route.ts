import { after, NextResponse } from "next/server";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { notifyBookingDecision } from "@/lib/push/notify";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getBookingById,
  getSeriesOccurrences,
  updateBooking,
  updateSeries,
  updateSeriesOccurrences,
} from "@/services/bookings";
import {
  canOverrideClash,
  clashErrorResponse,
  clashResponse,
  findVenueClashes,
  parseOverride,
  serverError,
  type ClashCandidate,
} from "@/lib/bookings/clash-guard";
import type { Conflict } from "@/lib/bookings/conflict-messages";

const toCandidate = (b: ClashCandidate): ClashCandidate => ({
  id: b.id,
  booking_date: b.booking_date,
  end_date: b.end_date ?? null,
  setup_time: b.setup_time ?? null,
  start_time: b.start_time ?? null,
  end_time: b.end_time ?? null,
  setdown_time: b.setdown_time ?? null,
});

// POST /api/bookings/[id]/decision — approve or deny a booking.
// Requires bookings.approve (admins qualify). Pass applyToSeries:true to
// decide every still-pending occurrence of a recurring series at once.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getBookingAccess(supabase, user.id);
  if (!access.canApprove) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { decision?: string; note?: string; applyToSeries?: boolean; override?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const decision = body.decision;
  if (decision !== "approved" && decision !== "denied") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'denied'" },
      { status: 400 }
    );
  }

  const { data: booking, error } = await getBookingById(supabase, id);
  if (error || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const note = (body.note ?? "").trim() || null;
  const override = parseOverride(body, access);
  if ("response" in override) return override.response;
  const stamp = {
    status: decision,
    decision_note: note,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
    ...(decision === "approved" && override.reason
      ? { clash_override_reason: override.reason }
      : {}),
  };

  // Approving re-checks the space: a request can have been made before the
  // clash guard, or the slot taken since. Denying never needs a check.
  const seriesWide = !!(body.applyToSeries && booking.series_id);
  const canOverride = canOverrideClash(access);
  let findClashes: () => Promise<Conflict[]> = async () => [];
  if (decision === "approved") {
    // Occurrences can sit in different spaces, so check each space's own.
    const byVenue = new Map<string, ClashCandidate[]>();
    const add = (venueId: string, c: ClashCandidate) =>
      byVenue.set(venueId, [...(byVenue.get(venueId) ?? []), toCandidate(c)]);
    if (seriesWide) {
      const { data: occRaw, error: occLoadErr } = await getSeriesOccurrences(supabase, booking.series_id);
      // Never approve dates we couldn't check.
      if (occLoadErr) return serverError("load series dates", occLoadErr, "Could not load the series.");
      for (const o of (occRaw ?? []) as Array<ClashCandidate & { status: string; venue_id: string }>) {
        if (o.status === "pending") add(o.venue_id, o);
      }
    } else if (booking.status !== "approved") {
      add(booking.venue_id, booking);
    }
    findClashes = async () =>
      (
        await Promise.all(
          [...byVenue].map(([venueId, list]) => findVenueClashes(supabase, venueId, list))
        )
      ).flat();
    const candidates = [...byVenue.values()].flat();
    const conflicts = candidates.length > 0 ? await findClashes() : [];
    if (conflicts.length > 0 && !override.reason) {
      return clashResponse(conflicts, booking.venue?.name, canOverride);
    }
  }
  const refused = (err: { code?: string; message?: string } | null) =>
    clashErrorResponse(err, { recheck: findClashes, venueName: booking.venue?.name, canOverride });

  if (seriesWide) {
    const { error: occErr } = await updateSeriesOccurrences(
      supabase,
      booking.series_id,
      stamp,
      true /* only still-pending occurrences */
    );
    if (occErr) {
      return (
        (await refused(occErr)) ??
        serverError("decide series", occErr, "Could not update the booking.")
      );
    }
    await updateSeries(supabase, booking.series_id, { status: decision });
    after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
    after(() => notifyBookingDecision({ booking, status: decision, deciderId: user.id })); // phone push
    return NextResponse.json({ ok: true, appliedToSeries: true });
  }

  const { error: updErr } = await updateBooking(supabase, id, stamp);
  if (updErr) {
    return (
      (await refused(updErr)) ??
      serverError("decide booking", updErr, "Could not update the booking.")
    );
  }

  after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
  after(() => notifyBookingDecision({ booking, status: decision, deciderId: user.id })); // phone push
  return NextResponse.json({ ok: true });
}
