// Prayer Room → Space Bookings: a devo set's alternate space.
//
// When a set can't run in the prayer room, the person booking it picks an
// alternate space (the Music Room first). The set then holds that space in
// Space Bookings — one venue_bookings row per set, titled with the set's
// title — and the set's relocation note names the space so the wall and the
// set drawer say where it moved to.
//
// Everything here takes the ADMIN client: set owners don't hold bookings.*
// permissions, and the booking belongs to the set rather than to them. The
// sets route has already checked the caller may create / edit the set.

import { PRAYER_ROOM_VENUE_SLUG } from "@/services/prayer-room-booking-suggestions";
import { getVenueBookingsBetween, insertSeries, deleteSeries, cancelBookings } from "@/services/bookings";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import { describeConflict, blockLead, type Conflict, type ExistingRow } from "@/lib/bookings/conflict-messages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AltVenue = { id: string; name: string; requires_approval: boolean };

const isMusicRoom = (v: { name: string; slug?: string }) =>
  v.slug === "music-room" || /^music room/i.test(v.name);

/** Every active space except the prayer room itself, Music Room first. */
export async function getAltVenueOptions(admin: Client): Promise<AltVenue[]> {
  const { data } = await admin
    .from("venues")
    .select("id, name, slug, requires_approval")
    .eq("is_active", true)
    .neq("slug", PRAYER_ROOM_VENUE_SLUG)
    .order("sort_order");
  const rows = (data ?? []) as (AltVenue & { slug: string })[];
  const music = rows.filter(isMusicRoom);
  return [...music, ...rows.filter((v) => !isMusicRoom(v))].map(({ id, name, requires_approval }) => ({
    id,
    name,
    requires_approval,
  }));
}

export function setBookingTitle(s: { title?: string | null; theme?: string | null }): string {
  return s.title?.trim() || s.theme?.trim() || "Devo set";
}

/**
 * Can the space be held on these dates at these times? A space that confirms
 * instantly has no manager to catch a clash, so a clash blocks — the same rule
 * as POST /api/bookings.
 */
export async function checkAltVenue(
  admin: Client,
  venueId: string,
  dates: string[],
  startTime: string,
  endTime: string
): Promise<{ venue: AltVenue; conflicts: Conflict[]; blocked: boolean; error?: string } | { error: string }> {
  const { data: venue } = await admin
    .from("venues")
    .select("id, name, requires_approval")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();
  if (!venue) return { error: "That space isn't available to book" };

  const sorted = [...dates].sort();
  const { data: existing } = await getVenueBookingsBetween(admin, venueId, sorted[0], sorted[sorted.length - 1]);
  const conflicts: Conflict[] = [];
  for (const d of sorted) {
    const candidate: BookingWindow = {
      id: "",
      venue_id: venueId,
      booking_date: d,
      end_date: null,
      setup_time: null,
      start_time: startTime,
      end_time: endTime,
      setdown_time: null,
      status: "pending",
    };
    for (const c of findConflicts(candidate, (existing ?? []) as ExistingRow[])) {
      conflicts.push(describeConflict(d, c as ExistingRow));
    }
  }
  const blocked = !venue.requires_approval && conflicts.length > 0;
  return {
    venue,
    conflicts,
    blocked,
    error: blocked ? `${venue.name}: ${blockLead(conflicts)}` : undefined,
  };
}

async function displayName(admin: Client, userId: string): Promise<string | null> {
  const { data: u } = await admin
    .from("users")
    .select("first_name, last_name, preferred_name")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return null;
  return [u.preferred_name || u.first_name, u.last_name].filter(Boolean).join(" ") || null;
}

/**
 * Book the space for the sets just created and link each set to its booking.
 * Weekly sets also get a booking_series so Space Bookings shows them as one
 * recurring booking.
 */
export async function bookAltVenue(
  admin: Client,
  input: {
    venue: AltVenue;
    sets: Array<{ id: string; set_date: string }>;
    title: string;
    startTime: string;
    endTime: string;
    userId: string;
    ownerId: string;
    weekly?: { weekday: number; series_start: string; series_end: string };
  }
): Promise<{ count: number; pending: boolean; error?: string }> {
  const { venue, sets, title, startTime, endTime, userId, ownerId } = input;
  const pending = venue.requires_approval;

  const [requester, owner, ministryRes] = await Promise.all([
    displayName(admin, userId),
    ownerId === userId ? Promise.resolve(null) : displayName(admin, ownerId),
    admin.from("ministries").select("id").eq("slug", "worship-prayer").maybeSingle(),
  ]);

  const shared = {
    venue_id: venue.id,
    ministry_id: ministryRes?.data?.id ?? null,
    title,
    description: "Devo set — moved from the prayer room.",
    point_person: owner ?? requester,
    start_time: startTime,
    end_time: endTime,
  };
  const status = pending ? "pending" : "approved";
  const decision = pending
    ? {}
    : {
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: "Booked from the Prayer Room for a devo set.",
      };

  let seriesId: string | null = null;
  if (input.weekly) {
    const { data: series, error } = await insertSeries(admin, {
      ...shared,
      weekday: input.weekly.weekday,
      series_start: input.weekly.series_start,
      series_end: input.weekly.series_end,
      status,
      created_by: userId,
    });
    if (error || !series) return { count: 0, pending, error: error?.message ?? "Failed to book the space" };
    seriesId = series.id;
  }

  const { data: rows, error } = await admin
    .from("venue_bookings")
    .insert(
      sets.map((s) => ({
        ...shared,
        series_id: seriesId,
        booking_date: s.set_date,
        end_date: null,
        status,
        ...decision,
        requested_by: userId,
        requester_name: requester,
      }))
    )
    .select("id, booking_date");
  if (error || !rows) {
    if (seriesId) await deleteSeries(admin, seriesId);
    return { count: 0, pending, error: error?.message ?? "Failed to book the space" };
  }

  const byDate = new Map((rows as { id: string; booking_date: string }[]).map((r) => [r.booking_date, r.id]));
  for (const s of sets) {
    await admin
      .from("prayer_room_sets")
      .update({ alt_venue_id: venue.id, alt_booking_id: byDate.get(s.set_date) ?? null, relocation_note: venue.name })
      .eq("id", s.id);
  }
  return { count: rows.length, pending };
}

/**
 * Keep the bookings in step after sets were edited: title, date and times
 * follow the set; a cancelled set cancels its booking.
 */
export async function syncAltBookings(
  admin: Client,
  filter: { setId?: string; seriesId?: string; fromDate?: string }
) {
  let q = admin
    .from("prayer_room_sets")
    .select("id, title, theme, set_date, start_time, end_time, status, alt_booking_id")
    .not("alt_booking_id", "is", null);
  if (filter.setId) q = q.eq("id", filter.setId);
  if (filter.seriesId) q = q.eq("series_id", filter.seriesId);
  if (filter.fromDate) q = q.gte("set_date", filter.fromDate);
  const { data } = await q;
  for (const s of (data ?? []) as Array<{
    title: string | null;
    theme: string | null;
    set_date: string;
    start_time: string;
    end_time: string;
    status: string;
    alt_booking_id: string;
  }>) {
    const patch: Record<string, unknown> = {
      title: setBookingTitle(s),
      booking_date: s.set_date,
      start_time: s.start_time,
      end_time: s.end_time,
      updated_at: new Date().toISOString(),
    };
    if (s.status === "cancelled") patch.status = "cancelled";
    await admin
      .from("venue_bookings")
      .update(patch)
      .eq("id", s.alt_booking_id)
      .not("status", "in", "(cancelled,denied)");
  }
}

/** The bookings held by these sets — read before the sets are deleted. */
export async function altBookingIdsFor(
  admin: Client,
  filter: { setId?: string; seriesId?: string; fromDate?: string }
): Promise<string[]> {
  let q = admin.from("prayer_room_sets").select("alt_booking_id").not("alt_booking_id", "is", null);
  if (filter.setId) q = q.eq("id", filter.setId);
  if (filter.seriesId) q = q.eq("series_id", filter.seriesId);
  if (filter.fromDate) q = q.gte("set_date", filter.fromDate);
  const { data } = await q;
  return ((data ?? []) as { alt_booking_id: string }[]).map((r) => r.alt_booking_id);
}

/** Free the space: cancel (not delete) so Space Bookings keeps the history. */
export async function releaseAltBookings(admin: Client, bookingIds: string[]) {
  if (bookingIds.length === 0) return;
  await cancelBookings(admin, bookingIds);
}
