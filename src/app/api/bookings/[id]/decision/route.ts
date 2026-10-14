import { after, NextResponse } from "next/server";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getBookingById,
  updateBooking,
  updateSeries,
  updateSeriesOccurrences,
} from "@/services/bookings";

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

  let body: { decision?: string; note?: string; applyToSeries?: boolean };
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
  const stamp = {
    status: decision,
    decision_note: note,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
  };

  if (body.applyToSeries && booking.series_id) {
    const { error: occErr } = await updateSeriesOccurrences(
      supabase,
      booking.series_id,
      stamp,
      true /* only still-pending occurrences */
    );
    if (occErr) {
      return NextResponse.json({ error: occErr.message }, { status: 500 });
    }
    await updateSeries(supabase, booking.series_id, { status: decision });
    after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
    return NextResponse.json({ ok: true, appliedToSeries: true });
  }

  const { error: updErr } = await updateBooking(supabase, id, stamp);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
  return NextResponse.json({ ok: true });
}
