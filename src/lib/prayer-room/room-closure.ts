/**
 * When the prayer room is closed to practice and to new sets on the wall.
 *
 * An approved booking of the auditorium (the prayer room's venue) occupies
 * the room from set-up through set-down, whether or not a devo set sits in
 * that window. A prayer-room block-out does the same. Pending, denied and
 * cancelled bookings do not.
 *
 * Times are the wall clock stored on the booking — Africa/Johannesburg, the
 * same clock practice uses. `date` and `time` columns have no zone, so this
 * never converts them through UTC. Touching at an edge is not an overlap.
 *
 * The same rules are enforced in the database by practice_assert_room_open
 * (migration 327). This module is what the wall and the practice UI grey
 * against. It never carries a booking title.
 */

import { occupiedWindow, type BookingWindow } from "@/lib/bookings/conflicts";
import { PRAYER_ROOM_VENUE_SLUG } from "@/lib/prayer-room/venue";

export const AUDITORIUM_BOOKED_LABEL = "Auditorium booked";
const BLOCKED_LABEL = "Blocked";
const DAY_END = 24 * 60;

export type RoomClosure = {
  id: string;
  block_date: string;
  end_date: string;
  /** Null times mean the whole day. */
  start_time: string | null;
  end_time: string | null;
  label: string;
  source: "auditorium" | "blockout";
};

export type AuditoriumBooking = {
  id: string;
  venueSlug: string;
  status: string;
  booking_date: string;
  end_date: string | null;
  setup_time: string | null;
  start_time: string | null;
  end_time: string | null;
  setdown_time: string | null;
};

export type BlockoutSpan = {
  id: string;
  block_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  reason?: string | null;
};

function hhmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toMin(t: string | null | undefined): number | null {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** Calendar date in Africa/Johannesburg for an instant. Bookings are stored on this date. */
export function johannesburgDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The closure an approved auditorium booking imposes, or null when this
 * booking does not close the room. Setup and set-down widen the window.
 * The result has no title and no requester.
 */
export function auditoriumClosure(b: AuditoriumBooking): RoomClosure | null {
  if (b.venueSlug !== PRAYER_ROOM_VENUE_SLUG) return null;
  if (b.status !== "approved") return null;

  const endDate = b.end_date && b.end_date > b.booking_date ? b.end_date : b.booking_date;
  const window = occupiedWindow({
    id: b.id,
    venue_id: b.venueSlug,
    booking_date: b.booking_date,
    end_date: b.end_date,
    setup_time: b.setup_time,
    start_time: b.start_time,
    end_time: b.end_time,
    setdown_time: b.setdown_time,
    status: b.status,
  } satisfies BookingWindow);
  const allDay = window.start <= 0 && window.end >= DAY_END;

  return {
    id: `auditorium:${b.id}`,
    block_date: b.booking_date,
    end_date: endDate,
    start_time: allDay ? null : hhmm(window.start),
    end_time: allDay ? null : hhmm(Math.min(window.end, DAY_END)),
    label: AUDITORIUM_BOOKED_LABEL,
    source: "auditorium",
  };
}

/** A block-out already on the schedule. A blank reason stays the generic "Blocked". */
export function blockoutClosure(b: BlockoutSpan): RoomClosure {
  const start = b.start_time ? hhmm(toMin(b.start_time) ?? 0) : null;
  const end = b.end_time ? hhmm(toMin(b.end_time) ?? 0) : null;
  const timed = !!start && !!end;
  return {
    id: b.id.startsWith("blockout:") ? b.id : `blockout:${b.id}`,
    block_date: b.block_date,
    end_date: b.end_date && b.end_date >= b.block_date ? b.end_date : b.block_date,
    start_time: timed ? start : null,
    end_time: timed ? end : null,
    label: b.reason?.trim() || BLOCKED_LABEL,
    source: "blockout",
  };
}

/** Strict overlap. Sharing an endpoint (one ends as the next starts) is free. */
export function minutesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Inclusive of neither extra day: the end may be at most this many days after the start. */
export const ROOM_CLOSURE_MAX_DAYS = 366;

/** True only for a real calendar day. 2026-02-30 matches the shape and is not a day. */
export function isCalendarDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function closureRangeTooLong(from: string, to: string): boolean {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return Math.round((end - start) / 86_400_000) > ROOM_CLOSURE_MAX_DAYS;
}

/**
 * Test mirror of the remainder filter in practice_move_plan and
 * practice_move_and_book_band (migration 327). The app does not call this.
 * Those SQL functions are what actually drop a leftover inside a closure.
 */
export function remainderSegments(
  bookingStart: number,
  bookingEnd: number,
  bandStart: number,
  bandEnd: number,
  closures: RoomClosure[],
  date: string
): { start: number; end: number }[] {
  const sides: { start: number; end: number }[] = [];
  if (bookingStart < bandStart) sides.push({ start: bookingStart, end: bandStart });
  if (bookingEnd > bandEnd) sides.push({ start: bandEnd, end: bookingEnd });
  return sides.filter((side) => side.end > side.start && !closureCovering(closures, date, side.start, side.end));
}

/**
 * Test mirror of the move message and of the lost window written by
 * practice_move_and_book_band. Not used by the app. A dropped remainder is
 * part of the loss, and the message says the rest is closed.
 */
export function bandMoveLossMirror(
  bookingStart: number,
  bookingEnd: number,
  bandStart: number,
  bandEnd: number,
  closures: RoomClosure[],
  date: string
): { kept: { start: number; end: number }[]; lostStart: number; lostEnd: number; closedNote: string } {
  const before = bookingStart < bandStart ? { start: bookingStart, end: bandStart } : null;
  const after = bookingEnd > bandEnd ? { start: bandEnd, end: bookingEnd } : null;
  const beforeHit = before ? closureCovering(closures, date, before.start, before.end) : null;
  const afterHit = after ? closureCovering(closures, date, after.start, after.end) : null;
  const kept = [before, after].filter((side): side is { start: number; end: number } => {
    if (!side) return false;
    return !closureCovering(closures, date, side.start, side.end);
  });
  const lostStart = before && beforeHit ? bookingStart : Math.max(bookingStart, bandStart);
  const lostEnd = after && afterHit ? bookingEnd : Math.min(bookingEnd, bandEnd);
  const auditorium = beforeHit?.source === "auditorium" || afterHit?.source === "auditorium";
  const blockout = beforeHit?.source === "blockout" || afterHit?.source === "blockout";
  const closedNote = auditorium
    ? "The rest is closed for an Auditorium booking."
    : blockout
      ? "The rest is closed."
      : "";
  return { kept, lostStart, lostEnd, closedNote };
}

/**
 * Drop an auditorium hatch when a block-out or a pending suggestion already
 * names that booking. The match is the booking id only. If the block-out's
 * times are later narrowed, the hatch stays hidden for the whole booking,
 * including any part the block-out no longer covers. That is drawing only:
 * practice still refuses the real occupied window.
 */
export function auditoriumClosuresToDraw<T extends { id: string }>(
  auditorium: T[],
  coveredBookingIds: Iterable<string>
): T[] {
  const covered = new Set(coveredBookingIds);
  return auditorium.filter((row) => {
    const id = row.id.startsWith("auditorium:") ? row.id.slice("auditorium:".length) : row.id;
    return !covered.has(id);
  });
}

/** The first closure that covers this slot, or null when the slot is free. */
export function closureCovering(
  closures: RoomClosure[],
  date: string,
  startMin: number,
  endMin: number
): RoomClosure | null {
  for (const c of closures) {
    if (date < c.block_date || date > c.end_date) continue;
    if (!c.start_time || !c.end_time) return c;
    const start = toMin(c.start_time);
    const end = toMin(c.end_time);
    // An unreadable window is treated as the whole day so a bad row cannot
    // look free. The booking path fails closed for the same reason.
    if (start == null || end == null) return c;
    if (minutesOverlap(startMin, endMin, start, end)) return c;
  }
  return null;
}
