// How a booking clash is described back to the person making it. Shared by
// every space-booking write (create, edit, series edit, approve) and the
// prayer-room alternate-space booking, so all of them word a clash identically.
//
// Only what the person needs to sort it out leaves the server: who holds the
// space (requester_name), what it's for (title), the date and the time window.
// Never emails, phone numbers or user ids.

import { humanDate, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import { occupiedWindow, type BookingWindow } from "@/lib/bookings/conflicts";

export type Conflict = {
  date: string;
  existingId: string;
  existingTitle: string;
  existingTime: string; // "18:00 – 21:00" or "all day"
  existingWindow: string; // what it actually holds, set-up to set-down: "17:30 – 21:30", "all day"
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

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The occupied window as words: "11:00 – 13:30", "22:00 – midnight", "all day". */
export function windowLabel(b: BookingWindow): string {
  const w = occupiedWindow(b);
  if (w.start === 0 && w.end === 24 * 60) return "all day";
  if (w.end === 24 * 60) return `${hhmm(w.start)} – midnight`;
  return timeRangeLabel(hhmm(w.start), hhmm(w.end));
}

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
    existingWindow: windowLabel(b),
    occupiedUntil: !multiDay && until ? timeLabel(until) : "the end of the day",
    who: b.requester_name ?? null,
  };
}

/**
 * The one-line lead for a refused booking, e.g.
 * Office 2 is already booked by Riley Botha ("SBS Staff Mtg") on Tue 1 Dec 2026, 11:30 – 13:00. Talk to them, or pick another time.
 */
export function blockLead(conflicts: Conflict[], venueName?: string | null): string {
  const space = venueName?.trim() || "This space";
  if (conflicts.length === 0) {
    return `${space} has just been booked at that time. Refresh to see the latest, then pick another time.`;
  }
  if (conflicts.length === 1) {
    const c = conflicts[0];
    const by = c.who ? ` by ${c.who}` : "";
    const tail = c.who
      ? "Talk to them, or pick another time."
      : "Pick another time, or check with whoever looks after the space.";
    return `${space} is already booked${by} ("${c.existingTitle}") on ${humanDate(c.date)}, ${c.existingWindow}. ${tail}`;
  }
  return `${space} is already booked at ${conflicts.length} of those times. Each one is listed below. Talk to the people who hold them, or pick other times.`;
}

/**
 * The one-line lead when an approval is refused because the space is taken, e.g.
 * Office 2 is already booked by Riley Botha ("SBS Staff Mtg") on Tue 1 Dec 2026, 11:30 – 13:00, so it can't be approved as it stands.
 * The "pick another time" wording is for the person booking, not for an approver.
 */
export function approveLead(conflicts: Conflict[], venueName?: string | null): string {
  const space = venueName?.trim() || "This space";
  if (conflicts.length === 0) {
    return `${space} has just been booked at that time. Refresh to see the latest, then try again.`;
  }
  if (conflicts.length === 1) {
    const c = conflicts[0];
    const by = c.who ? ` by ${c.who}` : "";
    return `${space} is already booked${by} ("${c.existingTitle}") on ${humanDate(c.date)}, ${c.existingWindow}, so it can't be approved as it stands.`;
  }
  return `${space} is already booked at ${conflicts.length} of those times, so they can't be approved as they stand. Each one is listed below.`;
}
