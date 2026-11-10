// L10 rocks are quarterly. The quarter label is the SAST calendar date,
// not the UTC date: a meeting at 00:30 in Johannesburg is still the
// previous evening in UTC.

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

export function isQuarter(value: string): boolean {
  return QUARTER_RE.test(value);
}

export function quarterOf(date: Date, timeZone = "Africa/Johannesburg"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

export function currentQuarter(now = new Date()): string {
  return quarterOf(now);
}

/** Calendar date in Africa/Johannesburg, `YYYY-MM-DD`. */
export function saTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const [day, month, year] = [read("day"), read("month"), read("year")];
  return `${year}-${month}-${day}`;
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Missing means "this quarter". A present value must already be `2026-Q4`
 * shaped — we do not coerce.
 */
export function parseQuarter(
  input: string | null
): { ok: true; quarter: string } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, quarter: currentQuarter() };
  if (!isQuarter(input)) return { ok: false, error: "Quarter must look like 2026-Q4" };
  return { ok: true, quarter: input };
}
