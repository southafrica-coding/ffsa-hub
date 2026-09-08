// How a booking clash is described back to the person making it. Shared by the
// create path (POST /api/bookings) and the series editor
// (PATCH /api/bookings/series/[id]) so both word a clash identically.

import { humanDate, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import type { BookingWindow } from "@/lib/bookings/conflicts";

export type Conflict = {
  date: string;
  existingId: string;
  existingTitle: string;
  existingTime: string; // "18:00 – 21:00" or "all day"
  occupiedUntil: string; // "21:30" (set-down/end) or "the end of the day"
  who: string | null; // requester_name of the existing booking
};

// Rows from getVenueBookingsBetween carry these display fields on top of the
// BookingWindow shape used for clash maths.
export type ExistingRow = BookingWindow & {
  title?: string;
  requester_name?: string | null;
  series_id?: string | null;
};

// Who holds the slot and until when, so the requester can adjust if it's only
// a small overlap.
export function describeConflict(date: string, b: ExistingRow): Conflict {
  const multiDay = b.end_date != null && b.end_date > b.booking_date;
  const hasTimes = !multiDay && (b.start_time || b.setup_time);
  const until = b.setdown_time ?? b.end_time;
  return {
    date,
    existingId: b.id,
    existingTitle: b.title ?? "another booking",
    existingTime: hasTimes ? timeRangeLabel(b.start_time, b.end_time) : "all day",
    occupiedUntil: !multiDay && until ? timeLabel(until) : "the end of the day",
    who: b.requester_name ?? null,
  };
}

// One-line lead for the hard-block message on auto-confirm spaces.
export function blockLead(conflicts: Conflict[]): string {
  if (conflicts.length === 1) {
    const c = conflicts[0];
    const who = c.who ? ` (${c.who})` : "";
    return `That time is already booked — “${c.existingTitle}”${who} has this space on ${humanDate(
      c.date
    )} until ${c.occupiedUntil}. Pick another time, or adjust yours so it doesn't overlap.`;
  }
  return `This space is already booked at ${conflicts.length} of those times. See the clashes below, then pick times that don't overlap.`;
}
