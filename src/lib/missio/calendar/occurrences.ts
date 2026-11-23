import { addDays, diffDays } from "./dates";
import { CALENDAR_CATEGORIES, CAMPUSES, type CalendarCampus, type CalendarCategory, type CalendarEvent } from "./types";

// ============================================================
// Occurrences: the dates an event lands on inside a range
// ============================================================
// A weekly series is stored once (RRULE in the feed). The screen expands
// it here: every n weeks from the first date, until a last date or a
// number of times, without the skipped dates.
// ============================================================

export type Occurrence = {
  /** Unique per event and start date. */
  key: string;
  event: CalendarEvent;
  startsOn: string;
  /** Inclusive. */
  endsOn: string;
  /** Zero-based position in the series (0 for a one-off). */
  index: number;
};

/** Hard stop for one series, so a bad row can't spin the browser. */
const MAX_REPEATS = 1040;

function occurrence(event: CalendarEvent, startsOn: string, endsOn: string, index: number): Occurrence {
  return { key: `${event.id}:${startsOn}`, event, startsOn, endsOn, index };
}

/** Occurrences of one event that touch [from, to] (both inclusive). */
export function expandEvent(event: CalendarEvent, from: string, to: string): Occurrence[] {
  const length = Math.max(0, diffDays(event.startsOn, event.endsOn));
  if (!event.repeat) {
    return event.endsOn >= from && event.startsOn <= to ? [occurrence(event, event.startsOn, event.endsOn, 0)] : [];
  }

  const step = Math.max(1, event.repeat.every) * 7;
  const skips = new Set(event.skipDates);
  const out: Occurrence[] = [];
  // Jump straight to the first repeat that could reach `from`.
  const first = Math.max(0, Math.floor((diffDays(event.startsOn, from) - length) / step));
  for (let i = first; i < MAX_REPEATS; i += 1) {
    if (event.repeat.count != null && i >= event.repeat.count) break;
    const start = addDays(event.startsOn, i * step);
    if (event.repeat.until && start > event.repeat.until) break;
    if (start > to) break;
    const end = addDays(start, length);
    if (end < from || skips.has(start)) continue;
    out.push(occurrence(event, start, end, i));
  }
  return out;
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? -1 : 1;
  // All-day first, then by start time, then longer spans first.
  const at = a.event.startTime ?? "";
  const bt = b.event.startTime ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.endsOn !== b.endsOn) return a.endsOn > b.endsOn ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

export function expandAll(events: CalendarEvent[], from: string, to: string): Occurrence[] {
  return events.flatMap((event) => expandEvent(event, from, to)).sort(compareOccurrences);
}

/** Does this occurrence cover `day`? */
export function covers(occ: Occurrence, day: string): boolean {
  return occ.startsOn <= day && occ.endsOn >= day;
}

/** A span longer than a week is shown as a band, not on every day. */
export function isLongSpan(occ: Occurrence): boolean {
  return diffDays(occ.startsOn, occ.endsOn) >= 7;
}

// ── Filters ─────────────────────────────────────────────────

export type CalendarView = "year" | "month" | "agenda";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["year", "month", "agenda"];

export type CalendarFilters = {
  categories: CalendarCategory[];
  campus: CalendarCampus;
};

export const ALL_FILTERS: CalendarFilters = { categories: [...CALENDAR_CATEGORIES], campus: "all" };

/** Potch shows Potch and all-campus events; "all" shows everything. */
export function matchesFilters(event: CalendarEvent, filters: CalendarFilters): boolean {
  if (!filters.categories.includes(event.category)) return false;
  if (filters.campus === "all") return true;
  return event.campus === "all" || event.campus === filters.campus;
}

export type CalendarQuery = CalendarFilters & { view: CalendarView; year: number; month: number };

const MIN_YEAR = 2020;
const MAX_YEAR = 2040;

/**
 * State in the address bar: ?view=month&y=2026&m=11&cats=sundays,events&campus=potch.
 * Anything missing or wrong falls back to the default (today, every category).
 */
export function parseCalendarQuery(search: string | URLSearchParams, today: string): CalendarQuery {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const view = params.get("view");
  const year = Number(params.get("y"));
  const month = Number(params.get("m"));
  const campus = params.get("campus");
  const rawCats = params.get("cats");
  const categories =
    rawCats == null
      ? [...CALENDAR_CATEGORIES]
      : CALENDAR_CATEGORIES.filter((category) => rawCats.split(",").includes(category));
  return {
    view: (CALENDAR_VIEWS as readonly string[]).includes(view ?? "") ? (view as CalendarView) : "year",
    year: Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : Number(today.slice(0, 4)),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : Number(today.slice(5, 7)),
    categories,
    campus: (CAMPUSES as readonly string[]).includes(campus ?? "") ? (campus as CalendarCampus) : "all",
  };
}

/** The inverse of parseCalendarQuery. Defaults are left out to keep links short. */
export function calendarQueryString(query: CalendarQuery, today: string): string {
  const params = new URLSearchParams();
  if (query.view !== "year") params.set("view", query.view);
  if (query.year !== Number(today.slice(0, 4))) params.set("y", String(query.year));
  if (query.view !== "year" && query.month !== Number(today.slice(5, 7))) params.set("m", String(query.month));
  if (query.categories.length !== CALENDAR_CATEGORIES.length) {
    params.set("cats", CALENDAR_CATEGORIES.filter((category) => query.categories.includes(category)).join(","));
  }
  if (query.campus !== "all") params.set("campus", query.campus);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function clampYear(year: number): number {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, year));
}
