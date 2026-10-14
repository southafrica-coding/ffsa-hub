import { after, NextResponse } from "next/server";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getBookingById,
  getVenueApproval,
  updateBooking,
  updateSeries,
  updateSeriesOccurrences,
} from "@/services/bookings";
import { callerLeadsBookingMinistry } from "@/lib/auth/check-ministry-access";

const EDITABLE_TEXT = ["venue_id", "title", "description", "point_person", "ministry_id"] as const;
const EDITABLE_DATETIME = [
  "booking_date",
  "end_date",
  "start_time",
  "end_time",
  "setup_time",
  "setdown_time",
] as const;

// Fields that decide WHEN and WHERE a booking physically sits. Changing any of
// them on an approved booking in an approval-required space sends it back to
// the space's manager; renaming the event or swapping the point person doesn't.
const SLOT_FIELDS = [
  "venue_id",
  "booking_date",
  "end_date",
  "start_time",
  "end_time",
  "setup_time",
  "setdown_time",
] as const;

// Postgres hands back times as "09:00:00" while the form sends "09:00", so
// compare on the hh:mm prefix rather than raw strings.
function sameSlotValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    const str = String(v);
    const m = str.match(/^(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : str;
  };
  return norm(a) === norm(b);
}

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
  const isMinistryLeader = await callerLeadsBookingMinistry(
    supabase,
    user.id,
    booking.ministry?.staff_ministry_id
  );
  if (!(access.isAdmin || access.canManage || access.canApprove || isOwner || isMinistryLeader)) {
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
    after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
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

  // Re-approval. An approved booking that moves in time or space has to be
  // re-checked by whoever looks after that space — but only for spaces flagged
  // requires_approval. Approvers and managers editing their own bookings stay
  // approved, mirroring the auto-confirm rule on the create path.
  const editorApproves = access.isAdmin || access.canApprove || access.canManage;
  const movedFields = SLOT_FIELDS.filter(
    (key) => key in patch && !sameSlotValue(patch[key], booking[key])
  );
  const movedSlot = body.cancel !== true && movedFields.length > 0;
  // A date change belongs to this occurrence alone, so it never re-opens the
  // rest of the series — only a shared move (venue or times) does.
  const movedSharedSlot = movedFields.some(
    (key) => key !== "booking_date" && key !== "end_date"
  );
  let reopened = false;

  if (movedSlot && booking.status === "approved" && !editorApproves) {
    const targetVenueId = (patch.venue_id as string | undefined) ?? booking.venue_id;
    const { data: venue } = await getVenueApproval(supabase, targetVenueId);
    if (venue?.requires_approval) {
      patch.status = "pending";
      patch.decided_by = null;
      patch.decided_at = null;
      patch.decision_note =
        "Re-opened for approval — the date, time or space changed after it was approved.";
      reopened = true;
    }
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
    const skip = new Set(["booking_date", "end_date"]);
    if (reopened && !movedSharedSlot) {
      // Only this date moved — the other occurrences keep their approval.
      skip.add("status").add("decided_by").add("decided_at").add("decision_note");
    }
    for (const key of Object.keys(patch)) {
      if (skip.has(key)) continue;
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
    after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
    return NextResponse.json({ ok: true, appliedToSeries: true, reopened });
  }

  after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
  return NextResponse.json({ ok: true, reopened });
}
