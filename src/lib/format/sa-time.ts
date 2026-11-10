// Event pages render on the server (often UTC) and hydrate in the browser.
// Locale data for en-ZA is not the same in Safari, Firefox and older Chrome
// (separators, field order, 12-hour "h" vs "HH"), which brings React #418
// back. Read numeric parts in Africa/Johannesburg and assemble a fixed
// English pattern. Month names come from the array, not the engine.

const TIME_ZONE = "Africa/Johannesburg";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

type Instant = Date | string | number;
type Clock = "none" | "seconds";

function asDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string {
  const value = parts.find((item) => item.type === type)?.value;
  if (value == null) throw new Error(`Missing date part: ${type}`);
  return value;
}

function digits(value: string, width: number): string {
  return value.replace(/\D/g, "").padStart(width, "0");
}

// hourCycle "h23" is 00–23. "h24" prints midnight as 24, which must not leak.
function hour23(value: string): string {
  const hour = digits(value, 2);
  return hour === "24" ? "00" : hour;
}

function monthName(value: string): string {
  const name = MONTHS[Number(digits(value, 2)) - 1];
  if (!name) throw new Error(`Bad month: ${value}`);
  return name;
}

function zonedParts(date: Date, timeZone: string, clock: Clock): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(clock === "seconds"
      ? { hour: "2-digit" as const, minute: "2-digit" as const, second: "2-digit" as const }
      : {}),
  }).formatToParts(date);
}

/** "11 Nov 2026", or "11 Nov 2026, 00:15:30" when the clock is included. */
function formatZoned(date: Date, timeZone: string, clock: Clock): string {
  const parts = zonedParts(date, timeZone, clock);
  const text = `${digits(part(parts, "day"), 2)} ${monthName(part(parts, "month"))} ${digits(part(parts, "year"), 4)}`;
  if (clock === "none") return text;
  return `${text}, ${hour23(part(parts, "hour"))}:${digits(part(parts, "minute"), 2)}:${digits(part(parts, "second"), 2)}`;
}

/** Date and time. Seconds stay, because these rows already showed them. */
export function formatSaDateTime(value: Instant): string {
  return formatZoned(asDate(value), TIME_ZONE, "seconds");
}

/** Time of day, including seconds (the check-in "Updated" clock). */
export function formatSaTime(value: Instant): string {
  const parts = zonedParts(asDate(value), TIME_ZONE, "seconds");
  return `${hour23(part(parts, "hour"))}:${digits(part(parts, "minute"), 2)}:${digits(part(parts, "second"), 2)}`;
}

/** Calendar date of an instant in South Africa. */
export function formatSaDate(value: Instant): string {
  return formatZoned(asDate(value), TIME_ZONE, "none");
}

/**
 * "12 Sep 2026" or "12 Sep 2026 – 14 Sep 2026".
 * start/end are calendar dates (YYYY-MM-DD), read in UTC so the day never
 * shifts when the server is not in South Africa.
 */
export function formatDayRange(start: string, end: string | null): string {
  const fmt = (iso: string) => formatZoned(new Date(`${iso}T00:00:00Z`), "UTC", "none");
  const startLabel = fmt(start);
  if (!end || end === start) return startLabel;
  return `${startLabel} – ${fmt(end)}`;
}
