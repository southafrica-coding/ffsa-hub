// Dates and numbers as the FFSA Fleet app shows them. Dates are plain "YYYY-MM-DD"
// strings; all arithmetic is done in UTC so the server's time zone never shifts a day.
// Output is assembled from fixed patterns (like src/lib/format/sa-time.ts) instead of
// toLocaleDateString, so server and browser always agree.

import type { ISODate } from "./types";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const has = (v: unknown): boolean => v !== null && v !== undefined && v !== "";

const D = (s: ISODate) => new Date(s + "T00:00:00Z");
const iso = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function addDays(s: ISODate, n: number): ISODate {
  const d = D(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
/** Monday = 1 … Sunday = 7. */
export const isoWeekday = (s: ISODate): number => D(s).getUTCDay() || 7;
export const weekStartOf = (s: ISODate): ISODate => addDays(s, 1 - isoWeekday(s));
export const monthStart = (s: ISODate): ISODate => s.slice(0, 8) + "01";
export const daysBetween = (a: ISODate, b: ISODate): number =>
  Math.round((D(b).getTime() - D(a).getTime()) / 864e5);
export const daysUntil = (s: ISODate, today: ISODate): number => daysBetween(today, s);
export function addMonths(s: ISODate, n: number): ISODate {
  const d = D(s);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}

const dd = (s: ISODate) => String(D(s).getUTCDate()).padStart(2, "0");
/** "Wed, 18 Nov", "Tue, 01 Dec" (en-ZA, as the app and the Hub's sa-time.ts show it) */
export const fmtDay = (s?: ISODate | null): string =>
  s ? `${DOW_SHORT[D(s).getUTCDay()]}, ${dd(s)} ${MON[D(s).getUTCMonth()]}` : "";
/** "18 Nov 2026", "01 Dec 2026" */
export const fmtDate = (s?: ISODate | null): string =>
  s ? `${dd(s)} ${MON[D(s).getUTCMonth()]} ${D(s).getUTCFullYear()}` : "—";
/** "18 Nov", "1 Dec" (the reminder's short date: no leading zero, as reminder.js) */
export const fmtShort = (s: ISODate): string => `${D(s).getUTCDate()} ${MON[D(s).getUTCMonth()]}`;
/** "Wednesday" */
export const dayName = (s: ISODate): string => DOW_LONG[D(s).getUTCDay()];
export const fmtRange = (a: ISODate, b?: ISODate | null): string =>
  !b || a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;

/** "312 606" with a no-break space (en-ZA), so a number never wraps on a phone */
export const fmtNum = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
/** "312 606 km", or "—" */
export const fmtKm = (n: unknown): string =>
  has(n) && !isNaN(Number(n)) ? fmtNum(Number(n)) + " km" : "—";
/** "22 min", "1 h 5 min" */
export const fmtMins = (m: number): string => {
  m = Math.round(Number(m) || 0);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`;
};
export const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Today's date in South Africa. */
export function todayInSA(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
