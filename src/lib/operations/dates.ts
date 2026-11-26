// Operations dates, always in South African time (UTC+2, no DST).

const SAST_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The SAST calendar date (YYYY-MM-DD) of an instant. */
export function sastDate(at: Date | string = new Date()): string {
  const t = typeof at === "string" ? new Date(at).getTime() : at.getTime();
  return new Date(t + SAST_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from date a to date b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Midnight SAST at the start of a date, as an instant. */
export function sastMidnight(iso: string): Date {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - SAST_MS);
}

/** Wednesday — the operations meeting, 10:00 SAST. */
export const MEETING_WEEKDAY = 3;

/**
 * The week a meeting looks at: from the previous meeting day (00:00 SAST)
 * to the coming one. On a Wednesday the meeting is today.
 */
export function meetingWeek(now: Date = new Date()): { from: string; meetingOn: string } {
  const today = sastDate(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const meetingOn = addDays(today, (MEETING_WEEKDAY - dow + 7) % 7);
  return { from: addDays(meetingOn, -7), meetingOn };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 25 Nov" */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** A due date in words, seen from today: "due today", "was due yesterday". */
export function dueWords(due: string, today: string): string {
  const n = daysBetween(today, due);
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n > 1) return `due ${dayLabel(due)}`;
  if (n === -1) return "was due yesterday";
  return `was due ${dayLabel(due)}`;
}
