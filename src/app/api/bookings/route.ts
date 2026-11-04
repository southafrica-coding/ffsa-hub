import { after, NextResponse } from "next/server";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { notifyNewBookingRequest } from "@/lib/push/notify";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getVenueApproval,
  getVenueBookingsBetween,
  insertBooking,
  insertBookings,
  insertSeries,
  deleteSeries,
} from "@/services/bookings";
import { weeklyOccurrenceDates } from "@/lib/bookings/recurrence";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import {
  describeConflict,
  blockLead,
  type Conflict,
  type ExistingRow,
} from "@/lib/bookings/conflict-messages";

type CreateBody = {
  dryRun?: boolean;
  venue_id?: string;
  ministry_id?: string | null;
  title?: string;
  description?: string;
  point_person?: string;
  requester_name?: string;
  start_time?: string;
  end_time?: string;
  setup_time?: string;
  setdown_time?: string;
  recurrence?: "none" | "weekly";
  booking_date?: string;
  end_date?: string;
  weekday?: number;
  series_start?: string;
  series_end?: string;
  interval_weeks?: number;
};

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

// POST /api/bookings — create a one-off or recurring-weekly booking request.
// Pass { dryRun: true } to only return clashes (used by the form before submit).
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getBookingAccess(supabase, user.id);
  if (!(access.canRequest || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const venueId = nn(body.venue_id);
  const title = nn(body.title);
  if (!venueId) return NextResponse.json({ error: "venue_id is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  // Approval routing: a space auto-confirms unless it's flagged as needing
  // approval. Managers / approvers always auto-confirm their own bookings.
  const { data: venue } = await getVenueApproval(supabase, venueId);
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 400 });
  const willAutoConfirm = !venue.requires_approval || access.canApprove;

  const recurrence = body.recurrence === "weekly" ? "weekly" : "none";
  const times = {
    start_time: nn(body.start_time),
    end_time: nn(body.end_time),
    setup_time: nn(body.setup_time),
    setdown_time: nn(body.setdown_time),
  };

  // Resolve the candidate occurrence dates.
  let occurrences: { booking_date: string; end_date: string | null }[] = [];
  let weekday: number | null = null;
  let seriesStart: string | null = null;
  let seriesEnd: string | null = null;

  let intervalWeeks = 1;
  if (recurrence === "weekly") {
    weekday = typeof body.weekday === "number" ? body.weekday : NaN;
    seriesStart = nn(body.series_start);
    seriesEnd = nn(body.series_end);
    if (weekday === null || Number.isNaN(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json({ error: "weekday (0–6) is required" }, { status: 400 });
    }
    if (!seriesStart || !seriesEnd) {
      return NextResponse.json({ error: "series_start and series_end are required" }, { status: 400 });
    }
    if (seriesEnd < seriesStart) {
      return NextResponse.json({ error: "series_end must be on or after series_start" }, { status: 400 });
    }
    const rawInterval = typeof body.interval_weeks === "number" ? body.interval_weeks : 1;
    if (!Number.isInteger(rawInterval) || rawInterval < 1 || rawInterval > 52) {
      return NextResponse.json({ error: "interval_weeks must be an integer between 1 and 52" }, { status: 400 });
    }
    intervalWeeks = rawInterval;
    const dates = weeklyOccurrenceDates(seriesStart, seriesEnd, weekday, intervalWeeks);
    if (dates.length === 0) {
      return NextResponse.json({ error: "No dates in that range fall on the chosen weekday" }, { status: 400 });
    }
    occurrences = dates.map((d) => ({ booking_date: d, end_date: null }));
  } else {
    const bookingDate = nn(body.booking_date);
    const endDate = nn(body.end_date);
    if (!bookingDate) {
      return NextResponse.json({ error: "booking_date is required" }, { status: 400 });
    }
    if (endDate && endDate < bookingDate) {
      return NextResponse.json({ error: "end_date must be on or after the start date" }, { status: 400 });
    }
    occurrences = [{ booking_date: bookingDate, end_date: endDate }];
  }

  // ── Conflict scan over the window touched by this request ──
  const allDates = occurrences
    .flatMap((o) => [o.booking_date, o.end_date ?? o.booking_date])
    .sort();
  const rangeFrom = allDates[0];
  const rangeTo = allDates[allDates.length - 1];

  const { data: existingRaw } = await getVenueBookingsBetween(
    supabase,
    venueId,
    rangeFrom,
    rangeTo
  );
  const existing = (existingRaw ?? []) as ExistingRow[];

  const conflicts: Conflict[] = [];
  for (const occ of occurrences) {
    const candidate: BookingWindow = {
      id: "",
      venue_id: venueId,
      booking_date: occ.booking_date,
      end_date: occ.end_date,
      status: "pending",
      ...times,
    };
    for (const c of findConflicts(candidate, existing)) {
      conflicts.push(describeConflict(occ.booking_date, c as ExistingRow));
    }
  }

  // On an auto-confirm space there's no manager to catch a clash, so a clash is
  // a HARD BLOCK (no silent double-booking). On approval-required spaces a clash
  // stays a warning — the manager reviews it in the queue.
  const blocked = willAutoConfirm && conflicts.length > 0;

  if (body.dryRun) {
    return NextResponse.json({ ok: true, conflicts, autoConfirm: willAutoConfirm, blocked });
  }

  if (blocked) {
    return NextResponse.json(
      { error: blockLead(conflicts), conflicts, blocked: true },
      { status: 409 }
    );
  }

  // ── Persist ──
  let requesterName = nn(body.requester_name);
  if (!requesterName) {
    const { data: u } = await supabase
      .from("users")
      .select("first_name,last_name")
      .eq("id", user.id)
      .single();
    if (u) requesterName = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
  }

  const ministryId = nn(body.ministry_id);
  const shared = {
    venue_id: venueId,
    ministry_id: ministryId,
    title,
    description: nn(body.description),
    point_person: nn(body.point_person),
    ...times,
  };

  // Status + audit stamp applied to each booking row when auto-confirming.
  const status = willAutoConfirm ? "approved" : "pending";
  const decision = willAutoConfirm
    ? {
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_note: venue.requires_approval
          ? "Auto-approved (booked by a manager)."
          : "Auto-confirmed — this space does not require approval.",
      }
    : {};

  if (recurrence === "weekly") {
    const { data: series, error: seriesErr } = await insertSeries(supabase, {
      ...shared,
      weekday,
      series_start: seriesStart,
      series_end: seriesEnd,
      interval_weeks: intervalWeeks,
      status,
      created_by: user.id,
    });

    if (seriesErr || !series) {
      return NextResponse.json(
        { error: seriesErr?.message ?? "Failed to create series" },
        { status: 500 }
      );
    }

    const rows = occurrences.map((o) => ({
      ...shared,
      series_id: series.id,
      booking_date: o.booking_date,
      end_date: null,
      status,
      ...decision,
      requested_by: user.id,
      requester_name: requesterName,
    }));

    const { error: occErr } = await insertBookings(supabase, rows);
    if (occErr) {
      // Best-effort cleanup so we don't leave an empty series behind.
      await deleteSeries(supabase, series.id);
      return NextResponse.json({ error: occErr.message }, { status: 500 });
    }

    after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
    if (status === "pending") {
      after(() => notifyNewBookingRequest({ requesterId: user.id, seriesId: series.id })); // phone push
    }
    return NextResponse.json({
      ok: true,
      seriesId: series.id,
      count: rows.length,
      conflicts,
      autoConfirm: willAutoConfirm,
    });
  }

  // One-off
  const { data: booking, error: bookingErr } = await insertBooking(supabase, {
    ...shared,
    booking_date: occurrences[0].booking_date,
    end_date: occurrences[0].end_date,
    status,
    ...decision,
    requested_by: user.id,
    requester_name: requesterName,
  });

  if (bookingErr || !booking) {
    return NextResponse.json(
      { error: bookingErr?.message ?? "Failed to create booking" },
      { status: 500 }
    );
  }

  after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
  if (status === "pending") {
    after(() => notifyNewBookingRequest({ requesterId: user.id, bookingId: booking.id })); // phone push
  }
  return NextResponse.json({
    ok: true,
    bookingId: booking.id,
    conflicts,
    autoConfirm: willAutoConfirm,
  });
}
