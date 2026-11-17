/**
 * Approved auditorium bookings, as the prayer room should see them.
 *
 * venue_bookings is readable only with bookings.view (and the alt-venue path
 * already notes that a set owner does not have it). Practice members still
 * have to see that the room is shut, so this read uses the admin client.
 * The select list is the occupancy columns only — never the title, the
 * description, or who booked it — and auditoriumClosure replaces all of that
 * with "Auditorium booked".
 *
 * A read failure is returned, not thrown. The wall logs it and keeps drawing.
 * Practice booking does not trust this read: practice_assert_room_open
 * (migration 327) rejects the write if the check itself errors.
 */

import { PRAYER_ROOM_VENUE_SLUG } from "@/lib/prayer-room/venue";
import { auditoriumClosure, type AuditoriumBooking, type RoomClosure } from "@/lib/prayer-room/room-closure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type BookingRow = {
  id: string;
  booking_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  setup_time: string | null;
  setdown_time: string | null;
  status: string;
};

const BOOKING_COLUMNS =
  "id, booking_date, end_date, start_time, end_time, setup_time, setdown_time, status";

function asTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export async function getAuditoriumClosures(
  admin: Client,
  from: string,
  to: string
): Promise<{ data: RoomClosure[]; error: { message: string } | null }> {
  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id")
    .eq("slug", PRAYER_ROOM_VENUE_SLUG)
    .maybeSingle();
  if (venueError) return { data: [], error: venueError };
  if (!venue) return { data: [], error: null };

  const { data, error } = await admin
    .from("venue_bookings")
    .select(BOOKING_COLUMNS)
    .eq("venue_id", venue.id)
    .eq("status", "approved")
    .lte("booking_date", to)
    .or(`booking_date.gte.${from},end_date.gte.${from}`)
    .order("booking_date");
  if (error) return { data: [], error };

  const closures = ((data ?? []) as BookingRow[])
    .map((row) => {
      const booking: AuditoriumBooking = {
        id: row.id,
        venueSlug: PRAYER_ROOM_VENUE_SLUG,
        status: row.status,
        booking_date: row.booking_date,
        end_date: row.end_date,
        setup_time: asTime(row.setup_time),
        start_time: asTime(row.start_time),
        end_time: asTime(row.end_time),
        setdown_time: asTime(row.setdown_time),
      };
      return auditoriumClosure(booking);
    })
    .filter((c): c is RoomClosure => c != null && c.block_date <= to && c.end_date >= from);

  return { data: closures, error: null };
}
