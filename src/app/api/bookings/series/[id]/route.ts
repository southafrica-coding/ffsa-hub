import { after, NextResponse } from "next/server";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getBookingAccess,
  getSeriesById,
  getSeriesOccurrences,
  getVenueApproval,
  insertBookings,
  deleteBookings,
  cancelBookings,
  updateBookingsByIds,
  updateSeries,
  updateSeriesOccurrences,
} from "@/services/bookings";
import { callerLeadsBookingMinistry } from "@/lib/auth/check-ministry-access";
import { reconcileSeries } from "@/lib/bookings/series-reconcile";
import {
  canOverrideClash,
  clashErrorResponse,
  clashResponse,
  findVenueClashes,
  parseOverride,
  serverError,
  todaySAST,
  type ClashCandidate,
} from "@/lib/bookings/clash-guard";
import { weeklyOccurrenceDates } from "@/lib/bookings/recurrence";

// Details every occurrence of a series shares. Changing one of these pushes it
// onto the future occurrences that still carry the old value.
const DETAIL_FIELDS = [
  "venue_id",
  "ministry_id",
  "title",
  "description",
  "point_person",
  "start_time",
  "end_time",
  "setup_time",
  "setdown_time",
] as const;

// The subset that decides WHERE and WHEN the series physically sits — a change
// to one of these on an approval-required space has to be re-confirmed.
const SLOT_FIELDS = new Set([
  "venue_id",
  "start_time",
  "end_time",
  "setup_time",
  "setdown_time",
]);

function nn(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length ? t : null;
}

// Postgres returns times as "18:00:00" while the form sends "18:00".
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    const m = String(v).match(/^(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : String(v);
  };
  return norm(a) === norm(b);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// PATCH /api/bookings/series/[id] — edit a whole weekly series, including its
// SCHEDULE: the weekday and the run of dates. Occurrences are reconciled —
// new dates are created, dropped dates removed, kept dates left exactly as they
// are so approvals and per-date overrides survive. Nothing on or before today
// is ever touched.
//
// Pass { dryRun: true } to get the plan and any clashes without writing, which
// is what the form shows before you commit.
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

  const { data: series, error: seriesErr } = await getSeriesById(supabase, id);
  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const access = await getBookingAccess(supabase, user.id);
  const isOwner = series.created_by === user.id;
  const isMinistryLeader = await callerLeadsBookingMinistry(
    supabase,
    user.id,
    series.ministry?.staff_ministry_id
  );
  if (!(access.isAdmin || access.canManage || access.canApprove || isOwner || isMinistryLeader)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: Record<string, unknown> & { dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── The new schedule ──
  const weekday =
    typeof body.weekday === "number" ? body.weekday : (series.weekday as number);
  const seriesStart = nn(body.series_start) ?? (series.series_start as string);
  const seriesEnd = nn(body.series_end) ?? (series.series_end as string);
  const rawInterval = typeof body.interval_weeks === "number" ? body.interval_weeks : ((series.interval_weeks ?? 1) as number);
  const intervalWeeks = Number.isInteger(rawInterval) && rawInterval >= 1 && rawInterval <= 52 ? rawInterval : 1;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "weekday must be 0–6" }, { status: 400 });
  }
  if (!ISO_DATE.test(seriesStart) || !ISO_DATE.test(seriesEnd)) {
    return NextResponse.json({ error: "series_start and series_end must be dates" }, { status: 400 });
  }
  if (seriesEnd < seriesStart) {
    return NextResponse.json(
      { error: "The last date must be on or after the first date." },
      { status: 400 }
    );
  }
  if (weeklyOccurrenceDates(seriesStart, seriesEnd, weekday, intervalWeeks).length === 0) {
    return NextResponse.json(
      { error: "No dates in that range fall on the chosen day of the week." },
      { status: 400 }
    );
  }

  // ── Changed details ──
  const detailPatch: Record<string, unknown> = {};
  for (const key of DETAIL_FIELDS) {
    if (!(key in body)) continue;
    const value = nn(body[key]);
    // Venue and title are required — a blank means "unchanged", not "clear it".
    if ((key === "venue_id" || key === "title") && !value) continue;
    if (sameValue(value, series[key])) continue;
    detailPatch[key] = value;
  }

  const targetVenueId = (detailPatch.venue_id as string | undefined) ?? series.venue_id;
  const { data: venue } = await getVenueApproval(supabase, targetVenueId);
  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 400 });
  }
  const willAutoConfirm = !venue.requires_approval || access.canApprove;

  const times = {
    start_time: (detailPatch.start_time as string | undefined) ?? series.start_time,
    end_time: (detailPatch.end_time as string | undefined) ?? series.end_time,
    setup_time: (detailPatch.setup_time as string | undefined) ?? series.setup_time,
    setdown_time: (detailPatch.setdown_time as string | undefined) ?? series.setdown_time,
  };

  // ── Plan ──
  const today = todaySAST();
  const { data: occRaw, error: occLoadErr } = await getSeriesOccurrences(supabase, id);
  if (occLoadErr) {
    return serverError("load series dates", occLoadErr, "Could not load the series.");
  }
  const occurrences = (occRaw ?? []) as Array<
    Record<string, unknown> & { id: string; booking_date: string; status: string }
  >;
  const plan = reconcileSeries(occurrences, today, weekday, seriesStart, seriesEnd, intervalWeeks);

  // ── What each kept future occurrence changes to. A detail is pushed onto an
  //    occurrence only while it still holds the series' OLD value — one that
  //    someone moved to its own time keeps it. Occurrences that take the same
  //    change are written together, so a move lands in one write per group
  //    (never venue first, then times, through a half-moved state). ──
  const changeGroups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  const movedKept: Array<ClashCandidate & { venue_id: string }> = [];
  for (const occ of plan.keep) {
    if (occ.status === "cancelled" || occ.status === "denied") continue;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(detailPatch)) {
      if (sameValue(occ[key], series[key])) patch[key] = detailPatch[key];
    }
    const keys = Object.keys(patch).sort();
    if (keys.length === 0) continue;
    const signature = keys.join(",");
    const group = changeGroups.get(signature) ?? { patch, ids: [] };
    group.ids.push(occ.id);
    changeGroups.set(signature, group);
    // Only a move needs a clash check: renaming a series that already overlaps
    // something must still work.
    if (keys.some((key) => SLOT_FIELDS.has(key))) {
      const after = { ...occ, ...patch } as Record<string, unknown>;
      movedKept.push({
        id: occ.id,
        venue_id: after.venue_id as string,
        booking_date: occ.booking_date,
        end_date: (after.end_date as string | null) ?? null,
        setup_time: (after.setup_time as string | null) ?? null,
        start_time: (after.start_time as string | null) ?? null,
        end_time: (after.end_time as string | null) ?? null,
        setdown_time: (after.setdown_time as string | null) ?? null,
      });
    }
  }

  // ── Clash check: every new date, and every kept date that moves ──
  // Refused on every space (the database refuses it too, migration 403); a
  // space manager can book over it with a reason. Our own occurrences aren't
  // clashes with ourselves.
  const byVenue = new Map<string, ClashCandidate[]>();
  for (const date of plan.add) {
    byVenue.set(targetVenueId, [
      ...(byVenue.get(targetVenueId) ?? []),
      { booking_date: date, end_date: null, ...times },
    ]);
  }
  for (const { venue_id, ...candidate } of movedKept) {
    byVenue.set(venue_id, [...(byVenue.get(venue_id) ?? []), candidate]);
  }
  const findClashes = async () =>
    (
      await Promise.all(
        [...byVenue].map(([venueId, list]) =>
          findVenueClashes(supabase, venueId, list, { excludeSeriesId: id })
        )
      )
    ).flat();
  const conflicts = byVenue.size > 0 ? await findClashes() : [];
  const blocked = conflicts.length > 0;
  const canOverride = canOverrideClash(access);

  const planSummary = {
    add: plan.add,
    remove: plan.remove.map((o) => ({ id: o.id, date: o.booking_date })),
    keep: plan.keep.length,
    frozen: plan.frozen.length,
  };

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      plan: planSummary,
      conflicts,
      blocked,
      canOverride,
      autoConfirm: willAutoConfirm,
    });
  }

  const override = parseOverride(body, access);
  if ("response" in override) return override.response;
  if (blocked && !override.reason) {
    return clashResponse(conflicts, venue.name, canOverride);
  }
  const overrideFields = override.reason ? { clash_override_reason: override.reason } : {};
  const refused = (err: { code?: string; message?: string } | null) =>
    clashErrorResponse(err, { recheck: findClashes, venueName: venue.name, canOverride });

  const scheduleChanged =
    weekday !== series.weekday ||
    seriesStart !== series.series_start ||
    seriesEnd !== series.series_end ||
    intervalWeeks !== (series.interval_weeks ?? 1);

  if (!scheduleChanged && Object.keys(detailPatch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // ── Write. No transactions on the client, so the order matters: the series
  //    row first (it's the one thing we can put back), then inserts, then
  //    updates, and deletes last — a failure part-way through leaves extra
  //    dates, which are visible and fixable, rather than gaps. ──
  const seriesPatch = {
    ...detailPatch,
    weekday,
    series_start: seriesStart,
    series_end: seriesEnd,
    interval_weeks: intervalWeeks,
  };
  const { data: updatedSeries, error: updErr } = await updateSeries(
    supabase,
    id,
    seriesPatch
  );
  if (updErr) {
    return serverError("update series", updErr, "Could not update the series.");
  }
  // RLS filters a forbidden update away silently rather than erroring.
  if (!updatedSeries) {
    return NextResponse.json(
      { error: "You don't have permission to change this series." },
      { status: 403 }
    );
  }

  // New occurrences inherit ownership from the newest existing one — a manager
  // extending someone's series must not take it over.
  const newest = occurrences[occurrences.length - 1];
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

  if (plan.add.length > 0) {
    const rows = plan.add.map((date) => ({
      venue_id: targetVenueId,
      ministry_id: (detailPatch.ministry_id as string | null | undefined) ?? series.ministry_id,
      title: (detailPatch.title as string | undefined) ?? series.title,
      description:
        (detailPatch.description as string | null | undefined) ?? series.description,
      point_person:
        (detailPatch.point_person as string | null | undefined) ?? series.point_person,
      ...times,
      series_id: id,
      booking_date: date,
      end_date: null,
      status,
      ...decision,
      ...overrideFields,
      requested_by: newest?.requested_by ?? user.id,
      requester_name: newest?.requester_name ?? null,
    }));
    const { error: insErr } = await insertBookings(supabase, rows);
    if (insErr) {
      // Put the schedule back — nothing else has been touched yet.
      await updateSeries(supabase, id, {
        ...Object.fromEntries(Object.keys(detailPatch).map((key) => [key, series[key]])),
        weekday: series.weekday,
        series_start: series.series_start,
        series_end: series.series_end,
        interval_weeks: series.interval_weeks ?? 1,
      });
      return (
        (await refused(insErr)) ??
        serverError("add series dates", insErr, "Could not update the series.")
      );
    }
  }

  // Push the changed details onto the kept future occurrences, one write per
  // group that takes the same change (worked out above).
  for (const { patch, ids } of changeGroups.values()) {
    const { error } = await updateBookingsByIds(supabase, ids, { ...patch, ...overrideFields });
    if (error) {
      return (
        (await refused(error)) ??
        serverError("move series dates", error, "Could not update the series.")
      );
    }
  }

  // Re-approval: only a real slot move, on a space that needs approval, made by
  // someone who can't approve. A pure weekday / date-range change moves no kept
  // occurrence, so it never re-opens one.
  const movedSlot = Object.keys(detailPatch).some((key) => SLOT_FIELDS.has(key));
  const editorApproves = access.isAdmin || access.canApprove || access.canManage;
  let reopened = false;
  if (movedSlot && venue.requires_approval && !editorApproves) {
    reopened = true;
    await updateSeriesOccurrences(
      supabase,
      id,
      {
        status: "pending",
        decided_by: null,
        decided_at: null,
        decision_note:
          "Re-opened for approval — the date, time or space changed after it was approved.",
      },
      false,
      { afterDate: today, skipClosed: true }
    );
  }

  // Deletes last. Hard-delete so a shortened run doesn't litter the calendar
  // with cancelled ghosts; fall back to cancelling anything RLS won't let us
  // remove, so the date at least stops holding the space.
  if (plan.remove.length > 0) {
    const ids = plan.remove.map((o) => o.id);
    const { data: deleted, error: delErr } = await deleteBookings(supabase, ids);
    if (delErr) {
      return serverError("remove series dates", delErr, "Could not update the series.");
    }
    const removedIds = new Set(((deleted ?? []) as { id: string }[]).map((r) => r.id));
    const survivors = ids.filter((rowId) => !removedIds.has(rowId));
    if (survivors.length > 0) {
      await cancelBookings(supabase, survivors);
    }
  }

  after(syncBookingAlerts); // prayer-room DM alerts (Auditorium over devo sets)
  return NextResponse.json({
    ok: true,
    plan: planSummary,
    conflicts,
    reopened,
    autoConfirm: willAutoConfirm,
  });
}
