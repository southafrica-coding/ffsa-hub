// The standard return rule (Gideon, 24 Nov 2026): a vehicle comes back the day AFTER the
// last day it's needed, before 12:00, washed, refuelled and with the return checks done.
// The forms ask for the last day; the booking's return_date is the day it's due back,
// so every clash and availability check blocks that morning for other bookings.

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The day it's due back: the day after the last day it's needed. */
export const dueBackFrom = (lastDay: string) => (lastDay ? shift(lastDay, 1) : lastDay);
/** The last day it's needed, from the due-back day. */
export const lastDayFrom = (dueBack: string) => (dueBack ? shift(dueBack, -1) : dueBack);

export const RETURN_BY = "12:00";

/** "Due back Thu, 26 Nov before 12:00" for the forms. */
export function dueBackHint(lastDay: string): string {
  if (!lastDay) return `Due back the next day, before ${RETURN_BY}.`;
  const d = new Date(dueBackFrom(lastDay) + "T00:00:00Z");
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(/^(\w+),? /, "$1, ");
  return `Due back ${label}, before ${RETURN_BY}: washed, refuelled and checked.`;
}

/** A driver's email, tidied; null when empty or not an email (the field is optional). */
export function driverEmail(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t && t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}
