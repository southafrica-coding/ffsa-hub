// Hire dates are calendar days (YYYY-MM-DD), inclusive, on the South African
// calendar. The math here runs on UTC midnights so a server in UTC and a
// phone in SAST agree; "today" is always taken in Africa/Johannesburg and
// always written into links — see lib/bookings/nav.ts for why.

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toMs(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO.test(v) && !Number.isNaN(toMs(v));
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY_MS);
}

/** Inclusive day count: Fri → Mon is 4 days. */
export function dayCount(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  return new Date(toMs(iso)).getUTCDay();
}

const SAST_YMD = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Africa/Johannesburg",
});

/** Today in South Africa, as YYYY-MM-DD. */
export function sastToday(now: Date = new Date()): string {
  return SAST_YMD.format(now);
}

/** The next Friday → Monday that hasn't started yet (today counts if it's Friday). */
export function comingWeekend(today: string): { from: string; to: string } {
  const toFriday = (5 - weekday(today) + 7) % 7;
  const from = addDays(today, toFriday);
  return { from, to: addDays(from, 3) };
}

export type HireRange = { from: string; to: string; chosen: boolean };

/**
 * Dates from ?from=&to=. Anything missing, malformed, in the past or
 * backwards falls back to the coming weekend, flagged chosen: false.
 */
export function readRange(
  params: { from?: string | string[]; to?: string | string[] },
  today: string
): HireRange {
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const to = Array.isArray(params.to) ? params.to[0] : params.to;
  if (isIsoDate(from) && isIsoDate(to) && from >= today && to >= from && dayCount(from, to) <= 90) {
    return { from, to, chosen: true };
  }
  return { ...comingWeekend(today), chosen: false };
}

/** "Fri 6 Nov" */
export function dayLabel(iso: string): string {
  const d = new Date(toMs(iso));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 6 – Mon 9 Nov", or across months "Mon 30 Nov – Wed 2 Dec". */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from);
  const a = new Date(toMs(from));
  const b = new Date(toMs(to));
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${WEEKDAYS[a.getUTCDay()]} ${a.getUTCDate()} – ${dayLabel(to)}`;
  }
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** "November 2026" for a YYYY-MM or a date in that month. */
export function monthLabel(isoOrMonth: string): string {
  const [y, m] = isoOrMonth.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Monday-first 6-week grid covering a YYYY-MM month: 42 ISO dates. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const back = (weekday(first) + 6) % 7; // days since Monday
  const start = addDays(first, -back);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
