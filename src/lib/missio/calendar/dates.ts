// Plain calendar dates ("YYYY-MM-DD") for the Missio calendar. Every date is
// a day in Johannesburg, which has no daylight saving, so day maths runs on
// UTC midnight and never meets a 23- or 25-hour day.

export const MISSIO_TIMEZONE = "Africa/Johannesburg";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. The calendar's weeks start on Monday. */
export function weekdayMon(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthStart(year: number, month: number): string {
  return isoDate(year, month, 1);
}

export function monthEnd(year: number, month: number): string {
  return isoDate(year, month, daysInMonth(year, month));
}

/** Today in Johannesburg. */
export function joburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MISSIO_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Tue 16 Dec". */
export function formatDay(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAY_SHORT[weekdayMon(date)]} ${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)}`;
}

/** "16 Dec 2026", or "16 Dec" when `withYear` is false. */
export function formatDate(date: string, withYear = true): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)}${withYear ? ` ${y}` : ""}`;
}

/** "14 Jan – 27 Mar", one day as "16 Dec". Years shown only when they differ. */
export function formatSpan(start: string, end: string): string {
  if (start === end) return formatDate(start, false);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDate(start, !sameYear)} – ${formatDate(end, !sameYear)}`;
}
