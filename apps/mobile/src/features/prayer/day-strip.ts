// The week as the phone shows it: Monday to Friday, one day at a time. The
// prayer room isn't bookable at weekends, so the strip has five days and the
// label reads Mon–Fri. Pure display logic: the API range and the saved-week
// cache stay keyed on the Sunday that starts the week (logic.ts weekStart).

import type { Blockout, PrayerSet, SeatType } from "./api";
import { groupWeek, myRelation, needsALead, shiftDays, weekStart, weekSummary, weekdayOf, type DayGroup } from "./logic";

const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The Sunday key of the week "This week" means. On a Saturday the room's
 * week is over, so it is the coming week; a Sunday already starts it.
 */
export function currentWeekAnchor(today: string): string {
  return weekdayOf(today) === 6 ? shiftDays(today, 1) : weekStart(today);
}

/** Monday → Friday of the week containing `anchor`. */
export function stripDays(anchor: string): string[] {
  const start = weekStart(anchor);
  return [1, 2, 3, 4, 5].map((i) => shiftDays(start, i));
}

/** The day to open a week on: today if it's one of the five, otherwise Monday. */
export function defaultDay(anchor: string, today: string): string {
  const days = stripDays(anchor);
  return days.includes(today) ? today : days[0];
}

/** "16–20 Nov 2026", "30 Nov – 4 Dec 2026", "28 Dec 2026 – 1 Jan 2027"; `year: false` drops the year. */
export function weekdayRangeLabel(anchor: string, { year = true }: { year?: boolean } = {}): string {
  const days = stripDays(anchor);
  const part = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
  const a = part(days[0]);
  const b = part(days[4]);
  const tail = year ? ` ${b.y}` : "";
  if (a.m === b.m) return `${a.d}–${b.d} ${MON_SHORT[b.m - 1]}${tail}`;
  const head = year && a.y !== b.y ? ` ${a.y}` : "";
  return `${a.d} ${MON_SHORT[a.m - 1]}${head} – ${b.d} ${MON_SHORT[b.m - 1]}${tail}`;
}

/** The five days with their sets and room blocks. Weekend days are never shown. */
export function stripWeek(anchor: string, sets: PrayerSet[], blockouts: Blockout[]): DayGroup[] {
  const days = stripDays(anchor);
  return groupWeek(anchor, sets, blockouts).filter((g) => days.includes(g.date));
}

/** Week totals over the five days shown. */
export function stripSummary(days: DayGroup[]): { sets: number; open: number; seats: number } {
  return weekSummary(days.flatMap((d) => d.sets));
}

export type DayMarker = "blocked" | "noLead" | "invited" | "you";

/** The ONE word a day carries in the strip. Priority: Blocked › No lead › Invited › You. */
export function dayMarker(day: DayGroup, seatTypes: SeatType[], userId: string | null): DayMarker | null {
  if (day.blockouts.length > 0) return "blocked";
  if (day.sets.some((s) => needsALead(s, seatTypes))) return "noLead";
  const relations = day.sets.map((s) => myRelation(s, userId));
  if (relations.includes("invited")) return "invited";
  if (relations.includes("serving")) return "you";
  return null;
}
