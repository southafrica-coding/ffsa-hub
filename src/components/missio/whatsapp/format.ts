import { STATUS_WORD, type MessageStatus } from "@/lib/missio/whatsapp/rules";

const TZ = "Africa/Johannesburg";
const time = new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const weekday = new Intl.DateTimeFormat("en-ZA", { weekday: "short", timeZone: TZ });
const dayMonth = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: TZ });
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
const longDay = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });

function daysBetween(a: Date, b: Date): number {
  return Math.round((Date.parse(dayKey.format(b)) - Date.parse(dayKey.format(a))) / 86_400_000);
}

/** Inbox time: 14:32 today, Yesterday, Mon this week, 12 Nov before that. SAST. */
export function listTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = daysBetween(at, now);
  if (days <= 0) return time.format(at);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekday.format(at);
  return dayMonth.format(at);
}

export function bubbleTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : time.format(at);
}

/** "Today", "Yesterday", or "Monday 17 November", for the day breaks in a thread. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = daysBetween(at, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return longDay.format(at);
}

export function sameDay(a: string, b: string): boolean {
  return dayKey.format(new Date(a)) === dayKey.format(new Date(b));
}

/** "until 14:32 tomorrow" / "until 09:10 today" */
export function windowUntil(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const days = daysBetween(now, at);
  return `until ${time.format(at)} ${days <= 0 ? "today" : "tomorrow"}`;
}

export function statusWord(status: MessageStatus): string {
  return STATUS_WORD[status];
}
