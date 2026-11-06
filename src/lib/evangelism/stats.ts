// Base-wide testimony totals for the supporter dashboard.
// Pure: the route loads published rows, this folds them. No database.

import type { TestimonyOutcome } from "./contract";
import { johannesburgDate } from "./contract";

export const STATS_RANGES = ["week", "month", "quarter", "year", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export type StatsRow = {
  occurred_on: string;
  location_label: string;
  people_reached: number;
  decisions: number;
  outcome: TestimonyOutcome | string;
  published_at: string | null;
};

export type EvangelismStats = {
  range: StatsRange;
  from: string;
  to: string;
  timezone: "Africa/Johannesburg";
  published_count: number;
  people_reached: number;
  decisions: number;
  by_outcome: Record<string, number>;
  by_location: Array<{
    location_label: string;
    testimonies: number;
    people_reached: number;
    decisions: number;
  }>;
  latest_published_at: string | null;
  /** True when the query cap was hit. Totals are then a floor, not a census. */
  truncated: boolean;
};

export function parseStatsRange(value: string | null): StatsRange {
  if (value && (STATS_RANGES as readonly string[]).includes(value)) return value as StatsRange;
  return "month";
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive date window ending on `today` (Johannesburg calendar day). */
export function statsWindow(range: StatsRange, today = johannesburgDate()): { from: string; to: string } {
  if (range === "all") return { from: "1970-01-01", to: today };
  if (range === "week") return { from: addDays(today, -6), to: today };
  const [y, m] = today.split("-").map(Number);
  if (range === "year") return { from: `${y}-01-01`, to: today };
  if (range === "quarter") {
    const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${y}-${String(startMonth).padStart(2, "0")}-01`, to: today };
  }
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: today };
}

export function aggregateTestimonies(
  rows: StatsRow[],
  options: { range: StatsRange; from: string; to: string; truncated?: boolean }
): EvangelismStats {
  const byOutcome: Record<string, number> = {};
  const locations = new Map<
    string,
    { location_label: string; testimonies: number; people_reached: number; decisions: number }
  >();
  let people = 0;
  let decisions = 0;
  let latest: string | null = null;

  for (const row of rows) {
    const reached = Math.max(0, row.people_reached || 0);
    const decided = Math.max(0, row.decisions || 0);
    people += reached;
    decisions += decided;
    const outcome = row.outcome || "other";
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    const label = (row.location_label || "Unspecified").trim() || "Unspecified";
    const bucket = locations.get(label) ?? {
      location_label: label,
      testimonies: 0,
      people_reached: 0,
      decisions: 0,
    };
    bucket.testimonies += 1;
    bucket.people_reached += reached;
    bucket.decisions += decided;
    locations.set(label, bucket);
    if (row.published_at && (!latest || row.published_at > latest)) latest = row.published_at;
  }

  const byLocation = [...locations.values()].sort((a, b) => b.people_reached - a.people_reached || a.location_label.localeCompare(b.location_label));

  return {
    range: options.range,
    from: options.from,
    to: options.to,
    timezone: "Africa/Johannesburg",
    published_count: rows.length,
    people_reached: people,
    decisions,
    by_outcome: byOutcome,
    by_location: byLocation,
    latest_published_at: latest,
    truncated: options.truncated ?? false,
  };
}
