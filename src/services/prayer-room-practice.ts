/**
 * Prayer room PRACTICE — reads and writes (handoff 17, migration 224).
 *
 * Reads: bookings, people and stations are readable to every signed-in user
 * (names are on the wall for everyone), but `users` is own-row-or-admin under
 * RLS, so names are resolved with the ADMIN client — the same split as
 * prayer-room-people.ts.
 *
 * Writes go through the migration's functions on the CALLER'S client, never
 * the admin one: auth.uid() inside them is who is booking, and their checks
 * are the point.
 *
 * Practice is not coverage. Nothing here reads or writes prayer_room_sets.
 */

import {
  DEFAULT_PRACTICE_SETTINGS,
  opensAt,
  practiceDays,
  sastNow,
  type PracticeBooking,
  type PracticeSettings,
  type PracticeStation,
  type PracticeWeek,
} from "@/lib/prayer-room/practice";

// The practice tables are not in the generated Database types yet (same loose
// client convention as services/prayer-room.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type NamedUser = { id: string; first_name: string | null; last_name: string | null };

function shiftISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function getPracticeSettings(supabase: Client): Promise<PracticeSettings> {
  const { data } = await supabase.from("practice_settings").select("*").maybeSingle();
  if (!data) return DEFAULT_PRACTICE_SETTINGS;
  return {
    start_time: String(data.start_time).slice(0, 5),
    end_time: String(data.end_time).slice(0, 5),
    slot_minutes: data.slot_minutes,
    closed_weekdays: data.closed_weekdays ?? [],
    closed_label: data.closed_label,
    max_minutes: data.max_minutes,
    opens_weekday: data.opens_weekday,
    opens_time: String(data.opens_time).slice(0, 5),
  };
}

export async function getPracticeStations(supabase: Client): Promise<PracticeStation[]> {
  const { data } = await supabase
    .from("practice_stations")
    .select("id, slug, label, short_label, seat_type_id, sort_order, max_people")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as PracticeStation[];
}

/** Active bookings with their people, names resolved. */
export async function getPracticeBookings(
  supabase: Client,
  admin: Client,
  from: string,
  to: string
): Promise<PracticeBooking[]> {
  const { data } = await supabase
    .from("practice_bookings")
    .select(
      "id, kind, practice_date, start_time, end_time, station_id, booked_by, band_name, people:practice_booking_people(user_id, station_id, created_at)"
    )
    .eq("status", "active")
    .gte("practice_date", from)
    .lte("practice_date", to)
    .order("practice_date")
    .order("start_time");

  type Row = Omit<PracticeBooking, "people"> & {
    people: { user_id: string; station_id: string; created_at: string }[];
  };
  const rows = (data ?? []) as Row[];

  const ids = [...new Set(rows.flatMap((r) => [r.booked_by, ...r.people.map((p) => p.user_id)]))];
  const names = new Map<string, NamedUser>();
  if (ids.length) {
    const { data: users } = await admin.from("users").select("id, first_name, last_name").in("id", ids);
    for (const u of (users ?? []) as NamedUser[]) names.set(u.id, u);
  }

  return rows.map((r) => ({
    ...r,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
    // The booker first, then in the order they were added — so a vocal group
    // reads "Sample +2" from the person who made it.
    people: [...r.people]
      .sort((a, b) =>
        a.user_id === r.booked_by ? -1 : b.user_id === r.booked_by ? 1 : a.created_at.localeCompare(b.created_at)
      )
      .map((p) => {
        const u = names.get(p.user_id);
        const first = u?.first_name || "Someone";
        return {
          user_id: p.user_id,
          station_id: p.station_id,
          first_name: first,
          full_name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || first,
        };
      }),
  }));
}

/** The station for a seat you are signed off for — 36b's "YOUR INSTRUMENT". */
async function defaultStationFor(supabase: Client, userId: string, stations: PracticeStation[]) {
  const { data } = await supabase
    .from("prayer_room_qualifications")
    .select("seat_type_id, state")
    .eq("user_id", userId)
    .in("state", ["signed_off", "in_training"]);
  const quals = (data ?? []) as { seat_type_id: string; state: string }[];
  // Signed off beats in training; ties go to the wall's own station order.
  for (const state of ["signed_off", "in_training"]) {
    const seats = new Set(quals.filter((q) => q.state === state).map((q) => q.seat_type_id));
    const hit = stations.find((s) => s.seat_type_id && seats.has(s.seat_type_id));
    if (hit) return hit.id;
  }
  return null;
}

export async function getPracticeWeek(
  supabase: Client,
  admin: Client,
  args: { anchor: string; userId: string; canBook: boolean; isStaff: boolean }
): Promise<PracticeWeek> {
  const days = practiceDays(args.anchor);
  const [settings, stations] = await Promise.all([getPracticeSettings(supabase), getPracticeStations(supabase)]);
  const [bookings, defaultStationId] = await Promise.all([
    getPracticeBookings(supabase, admin, days[0], days[4]),
    defaultStationFor(supabase, args.userId, stations),
  ]);
  return {
    settings,
    stations,
    bookings,
    days,
    opensAt: opensAt(settings, days[0]),
    nextOpensAt: opensAt(settings, shiftISO(days[0], 7)),
    now: sastNow(),
    me: { canBook: args.canBook, isStaff: args.isStaff, defaultStationId },
  };
}

// ── writes ────────────────────────────────────────────────

export function bookStation(
  supabase: Client,
  a: { date: string; start: string; end: string; stationId: string; singers: string[] }
) {
  return supabase.rpc("practice_book_station", {
    p_date: a.date,
    p_start: a.start,
    p_end: a.end,
    p_station: a.stationId,
    p_singers: a.singers,
  });
}

export type LineupEntry = { station_id: string; user_id: string };

export function bookBand(
  supabase: Client,
  a: { date: string; start: string; end: string; bandName: string; lineup: LineupEntry[] }
) {
  return supabase.rpc("practice_book_band", {
    p_date: a.date,
    p_start: a.start,
    p_end: a.end,
    p_band_name: a.bandName,
    p_lineup: a.lineup,
  });
}

export function cancelPractice(supabase: Client, bookingId: string) {
  return supabase.rpc("practice_cancel", { p_booking: bookingId });
}

export type MovePlanRow = {
  booking_id: string;
  user_id: string;
  person_name: string;
  station: string;
  booked_start: string;
  booked_end: string;
  lost_start: string;
  lost_end: string;
  kept: string | null;
  message: string;
};

export function getMovePlan(
  supabase: Client,
  a: { date: string; start: string; end: string; reason: string }
) {
  return supabase.rpc("practice_move_plan", {
    p_date: a.date,
    p_start: a.start,
    p_end: a.end,
    p_reason: a.reason,
  }) as Promise<{ data: MovePlanRow[] | null; error: { code?: string; message?: string } | null }>;
}

export function moveAndBookBand(
  supabase: Client,
  a: { date: string; start: string; end: string; bandName: string; lineup: LineupEntry[]; reason: string }
) {
  return supabase.rpc("practice_move_and_book_band", {
    p_date: a.date,
    p_start: a.start,
    p_end: a.end,
    p_band_name: a.bandName,
    p_lineup: a.lineup,
    p_reason: a.reason,
  });
}
