import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getBookingById,
  updateBooking,
  updateSeries,
  updateSeriesOccurrences,
} from "@/services/bookings";

const EDITABLE_TEXT = ["venue_id", "title", "description", "point_person", "ministry_id"] as const;
const EDITABLE_DATETIME = [
  "booking_date",
  "end_date",
  "start_time",
  "end_time",
  "setup_time",
  "setdown_time",
] as const;

// PATCH /api/bookings/[id] — edit fields and/or cancel a booking.
// Cancelling is a status change (we never hard-delete — keeps history visible).
// Allowed for the requester, or anyone with approve/manage (admins qualify).
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: booking, error } = await getBookingById(supabase, id);
  if (error || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const access = await getBookingAccess(supabase, user.id);
  const isOwner = booking.requested_by === user.id;
  if (!(access.isAdmin || access.canManage || access.canApprove || isOwner)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: Record<string, unknown> & { cancel?: boolean; applyToSeries?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Whole-series cancel (e.g. "stop this weekly booking").
  if (body.cancel === true && body.applyToSeries === true && booking.series_id) {
    const { error: occErr } = await updateSeriesOccurrences(supabase, booking.series_id, {
      status: "cancelled",
    });
    if (occErr) return NextResponse.json({ error: occErr.message }, { status: 500 });
    await updateSeries(supabase, booking.series_id, { status: "cancelled" });
    return NextResponse.json({ ok: true, appliedToSeries: true });
  }

  const patch: Record<string, unknown> = {};

  for (const key of EDITABLE_TEXT) {
    if (!(key in body)) continue;
    const raw = typeof body[key] === "string" ? (body[key] as string).trim() : null;
    // Required fields can't be blanked — skip them instead of nulling.
    if ((key === "title" || key === "venue_id") && !raw) continue;
    patch[key] = raw && raw.length ? raw : null;
  }
  for (const key of EDITABLE_DATETIME) {
    if (key in body) {
      const raw = typeof body[key] === "string" ? (body[key] as string).trim() : "";
      patch[key] = raw.length ? raw : null;
    }
  }

  if (body.cancel === true) {
    patch.status = "cancelled";
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error: updErr } = await updateBooking(supabase, id, patch);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // "Apply to all dates" — push the shared details onto every other occurrence
  // in the series. The dates themselves stay per-occurrence (each one is a
  // different day by definition), so they're excluded from the series patch.
  if (body.applyToSeries === true && booking.series_id && body.cancel !== true) {
    const seriesPatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (key === "booking_date" || key === "end_date") continue;
      seriesPatch[key] = patch[key];
    }
    if (Object.keys(seriesPatch).length > 0) {
      const { error: occErr } = await updateSeriesOccurrences(
        supabase,
        booking.series_id,
        seriesPatch,
        false,
        { excludeId: id, skipClosed: true }
      );
      if (occErr) {
        return NextResponse.json({ error: occErr.message }, { status: 500 });
      }
      // Keep the series definition itself in step, so future views/edits of
      // the series show the same details.
      await updateSeries(supabase, booking.series_id, seriesPatch);
    }
    return NextResponse.json({ ok: true, appliedToSeries: true });
  }

  return NextResponse.json({ ok: true });
}
