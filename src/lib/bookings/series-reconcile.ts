// Working out what a weekly series should look like after its schedule changes.
// Pure date/set maths — no Supabase, no wall clock — so the rules that matter
// (the past is never touched, approvals survive) are unit-testable.

import { weeklyOccurrenceDates } from "./recurrence";

export type SeriesOccurrence = {
  id: string;
  booking_date: string;
  status: string;
};

export type SeriesPlan<T extends SeriesOccurrence> = {
  /** ISO dates that need a new booking row. */
  add: string[];
  /** Future rows that stay exactly as they are (approval and all). */
  keep: T[];
  /** Future rows the new schedule no longer wants. */
  remove: T[];
  /** Rows on or before today — never moved, deleted or re-approved. */
  frozen: T[];
};

/**
 * Reconcile a series' occurrences against a new weekday / date range.
 *
 * `today` is passed in (ISO) rather than read, so the caller owns "now" and
 * tests stay deterministic. Anything on or before today is frozen: a booking
 * happening this afternoon must not vanish because someone shifted the run.
 */
export function reconcileSeries<T extends SeriesOccurrence>(
  occurrences: T[],
  today: string,
  weekday: number,
  seriesStart: string,
  seriesEnd: string
): SeriesPlan<T> {
  const frozen = occurrences.filter((o) => o.booking_date <= today);
  const future = occurrences.filter((o) => o.booking_date > today);

  const desired = new Set(
    weeklyOccurrenceDates(seriesStart, seriesEnd, weekday).filter((d) => d > today)
  );

  const keep: T[] = [];
  const remove: T[] = [];
  const covered = new Set<string>();
  for (const o of future) {
    if (desired.has(o.booking_date) && !covered.has(o.booking_date)) {
      covered.add(o.booking_date);
      keep.push(o);
    } else {
      // Either the date is no longer wanted, or it's a duplicate row for a date
      // we've already kept — both go.
      remove.push(o);
    }
  }

  const add = [...desired].filter((d) => !covered.has(d)).sort();

  return { add, keep, remove, frozen };
}
