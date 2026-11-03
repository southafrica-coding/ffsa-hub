// Date and time wording for tickets and the door. Hand-rolled (not
// toLocaleString) so it reads the same on every phone and in tests; names
// live here so they can be translated with the strings.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" as a local calendar date (no time-zone shift). */
function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "18:00:00" -> "18:00". */
export function formatTime(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

/** "2026-12-01" -> "Tue 1 Dec 2026". */
export function formatDay(day: string): string {
  const d = parseDay(day);
  if (!d) return day;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Short pieces for a date block: { day: "01", mon: "DEC" }. */
export function dateBlock(day: string): { day: string; mon: string } {
  const d = parseDay(day);
  if (!d) return { day: "--", mon: "" };
  return { day: pad(d.getDate()), mon: MONTHS[d.getMonth()].toUpperCase() };
}

type EventWhen = { startDate: string; startTime: string | null; endDate: string | null; endTime: string | null };

/** "Tue 1 Dec 2026 · 18:00" or "Fri 4 Dec 2026 – Sun 6 Dec 2026". */
export function formatEventWhen(e: EventWhen): string {
  const start = [formatDay(e.startDate), formatTime(e.startTime)].filter(Boolean).join(" · ");
  if (e.endDate && e.endDate !== e.startDate) return `${start} – ${formatDay(e.endDate)}`;
  const end = formatTime(e.endTime);
  return end ? `${start}–${end}` : start;
}

/** Local "YYYY-MM-DD" for today. */
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An event is past once its last day is before today (today still counts). */
export function isPastEvent(e: { startDate: string; endDate: string | null }, now: Date): boolean {
  return (e.endDate ?? e.startDate) < localDay(now);
}

/** ISO timestamp -> local "HH:MM". */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp -> "Tue 1 Dec 2026, 18:05" (for "last updated"). */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDay(localDay(d))}, ${formatClock(iso)}`;
}

/** Split into upcoming (soonest first) and past (most recent first). */
export function splitByWhen<T extends { event: { startDate: string; endDate: string | null; startTime: string | null } }>(
  items: T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const key = (t: T) => `${t.event.startDate}T${t.event.startTime ?? "00:00"}`;
  const sorted = [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const upcoming = sorted.filter((t) => !isPastEvent(t.event, now));
  const past = sorted.filter((t) => isPastEvent(t.event, now)).reverse();
  return { upcoming, past };
}
