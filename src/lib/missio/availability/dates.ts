/** Johannesburg calendar. Missio serves on South African dates, not UTC dates. */

const JOHANNESBURG = "Africa/Johannesburg";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function johannesburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JOHANNESBURG,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A service date is editable on that Johannesburg calendar day and before it.
 * The next day is closed. Comparison is on YYYY-MM-DD strings.
 */
export function canEditAvailability(serviceDate: string, today = johannesburgToday()): boolean {
  return isIsoDate(serviceDate) && isIsoDate(today) && serviceDate >= today;
}

export function daysBetween(startsOn: string, endsOn: string): number | null {
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Sundays inside the range, oldest first, capped at 12. */
export function sundaysBetween(startsOn: string, endsOn: string): string[] {
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn) || startsOn > endsOn) return [];
  const dates: string[] = [];
  let cursor = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  while (cursor <= end && dates.length < 12) {
    const date = new Date(cursor);
    if (date.getUTCDay() === 0) dates.push(date.toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return dates;
}

/**
 * The public page shows the next 4 to 6 service dates.
 * Upcoming dates come first, capped at 6. When fewer than 4 are still
 * ahead, the most recent past dates fill the window so a closed Sunday
 * stays visible and read-only. Fewer than 4 dates in the request are
 * all shown.
 */
export function visibleServiceDates(dates: readonly string[], today: string): string[] {
  if (!isIsoDate(today)) return [];
  const unique = [...new Set(dates.filter(isIsoDate))].sort();
  const upcoming = unique.filter((date) => date >= today);
  const past = unique.filter((date) => date < today);
  const next = upcoming.slice(0, 6);
  if (next.length >= 4 || past.length === 0) return next;
  const need = Math.min(4, unique.length) - next.length;
  return [...past.slice(-need), ...next];
}

/** Labels for Sundays that are still open. A date before `today` is left out. */
export function upcomingServiceLabels(dates: readonly string[], today: string): string[] {
  return dates.filter((date) => isIsoDate(date) && isIsoDate(today) && date >= today).map((date) => formatServiceLabel(date, "long"));
}

export function formatServiceLabel(iso: string, style: "long" | "short" = "long"): string {
  if (!isIsoDate(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: style === "long" ? "long" : undefined,
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return formatted.replace(",", "");
}

/**
 * The link works through the last service date and expires at
 * 00:00 SAST the next day. South Africa does not observe daylight saving.
 */
export function tokenExpiresAt(serviceDates: readonly string[]): string {
  const last = [...serviceDates].filter(isIsoDate).sort().at(-1);
  if (!last) throw new Error("A request needs a service date.");
  const [year, month, day] = last.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 22, 0, 0)).toISOString();
}

export function isTokenExpired(expiresAt: string, now = new Date()): boolean {
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) return true;
  return now.getTime() >= time;
}
