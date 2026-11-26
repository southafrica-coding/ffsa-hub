// The hold after an International Team booking (Gideon, 24 Nov 2026): the vehicles are
// kept back for 3 working days after the due-back day, for the post-rental inspection and
// a full valet wash. Working days are Mon–Fri, not South African public holidays
// (sa-holidays.ts); weekends and holidays inside that stretch are held too. The Vehicle Coordinator
// can release a hold, with a note saying why.
//
// The hold isn't stored: it follows from the booking's purpose and due-back day, so an
// early return or a date change moves it. Migration 365's vehicle_hold_end() is the same
// arithmetic for the calendar counts; hold.test.ts keeps the two in step.

import { isWorkingDay } from "./sa-holidays";

export const HOLD_PURPOSE = "international_team";
export const HOLD_WORKING_DAYS = 3;

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The last held day: the 3rd working day (Mon–Fri, not a public holiday) after the due-back day. */
export function holdEnd(returnDate: string): string {
  let d = returnDate;
  for (let n = 0; n < HOLD_WORKING_DAYS; ) {
    d = shift(d, 1);
    if (isWorkingDay(d)) n++;
  }
  return d;
}

/** Further than a hold can run past the due-back day (Easter and Christmas run ~7). */
export const HOLD_MAX_DAYS = 14;

export type HoldFields = {
  purpose?: string | null;
  return_date: string;
  hold_released_at?: string | null;
};

export const hasHold = (b: HoldFields) => b.purpose === HOLD_PURPOSE && !b.hold_released_at && !!b.return_date;

/** The held days after the due-back day, or null when the booking has no hold. */
export function holdDays(b: HoldFields): { from: string; to: string } | null {
  return hasHold(b) ? { from: shift(b.return_date, 1), to: holdEnd(b.return_date) } : null;
}

/** The last day a booking keeps its vehicles: the due-back day, or the end of its hold. */
export const blockEnd = (b: HoldFields) => (hasHold(b) ? holdEnd(b.return_date) : b.return_date);

/** Booking statuses whose vehicles are taken: a hold also outlasts completion. */
export const LIVE_STATUSES = ["pending", "approved"];
export const HOLD_STATUSES = ["pending", "approved", "completed"];

/**
 * Does this booking keep its vehicles on any day of [from, to]? A pending or approved
 * booking does from collection to the due-back day; an International Team booking also
 * through its hold, and still after it's been completed (the valet may not be done yet).
 */
export function blocksWindow(
  b: HoldFields & { status: string; checkout_date: string },
  from: string,
  to: string
): boolean {
  if (b.checkout_date > to) return false;
  if (LIVE_STATUSES.includes(b.status) && b.return_date >= from) return true;
  const held = HOLD_STATUSES.includes(b.status) ? holdDays(b) : null;
  return !!held && held.from <= to && held.to >= from;
}

/** The earliest due-back day whose hold can still reach `from`. */
export const holdLookback = (from: string) => shift(from, -HOLD_MAX_DAYS);
