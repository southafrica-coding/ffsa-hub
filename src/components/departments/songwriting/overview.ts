import type { PwContinent, PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";

/** UN member states plus two observers: the "out of 195" on the hero. */
export const WORLD_NATIONS = 195;

export interface YearColumn {
  year: number;
  trainings: number;
  trained: number;
  songsWorkshop: number;
  songsAfter: number;
  /** Nations whose first completed training falls in this year. */
  newNations: number;
  /** Distinct continents of those new nations. */
  continents: number;
}

export interface OverviewTotals {
  years: YearColumn[];
  total: {
    trainings: number;
    trained: number;
    songsWorkshop: number;
    songsAfter: number;
    newNations: number;
    /** Never summed: the same continent can be new in two years. Shown as "—". */
    continents: null;
  };
  nationsReached: number;
  tentativeNations: PwNation[];
  /** Workshop + after. Approximate: some counts are unknown. */
  songsApprox: number;
  librarySongs: number;
  openLeads: number;
  /** First and last completed training month, or null with none. */
  span: { from: { year: number; month: number }; to: { year: number; month: number } } | null;
  latest: PwSongwritingTraining | null;
}

export function isCompleted(training: PwSongwritingTraining): boolean {
  return training.status === "completed";
}

/** year*12+month, for ordering. */
export function monthKey(t: { year: number; month: number }): number {
  return t.year * 12 + (t.month - 1);
}

/** Newest first; stable on created_at for the same month. */
export function newestFirst(a: PwSongwritingTraining, b: PwSongwritingTraining): number {
  return monthKey(b) - monthKey(a) || b.created_at.localeCompare(a.created_at);
}

/** Each nation's first completed training. */
export function firstTrainingByNation(trainings: readonly PwSongwritingTraining[]): Map<string, PwSongwritingTraining> {
  const first = new Map<string, PwSongwritingTraining>();
  for (const t of trainings) {
    if (!isCompleted(t) || !t.nation_id) continue;
    const seen = first.get(t.nation_id);
    if (!seen || monthKey(t) < monthKey(seen) || (monthKey(t) === monthKey(seen) && t.created_at < seen.created_at)) {
      first.set(t.nation_id, t);
    }
  }
  return first;
}

const sum = (values: (number | null)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

/**
 * The Overview numbers. Completed trainings only, like pw_songwriting_totals;
 * unknown counts (null) add as 0. Nations reached counts nations with a
 * completed training, tentative ones included and also listed separately.
 */
export function computeOverview(input: {
  nations: readonly PwNation[];
  trainings: readonly PwSongwritingTraining[];
  librarySongs?: number;
  openLeads?: number;
}): OverviewTotals {
  const done = input.trainings.filter(isCompleted);
  const nationById = new Map(input.nations.map((n) => [n.id, n]));
  const firsts = firstTrainingByNation(done);

  const yearsSeen = [...new Set(done.map((t) => t.year))].sort((a, b) => a - b);
  const years: YearColumn[] = yearsSeen.map((year) => {
    const rows = done.filter((t) => t.year === year);
    const newNationIds = [...firsts.entries()].filter(([, t]) => t.year === year).map(([id]) => id);
    const continents = new Set<PwContinent>();
    for (const id of newNationIds) {
      const continent = nationById.get(id)?.continent;
      if (continent) continents.add(continent);
    }
    return {
      year,
      trainings: rows.length,
      trained: sum(rows.map((t) => t.people_trained)),
      songsWorkshop: sum(rows.map((t) => t.songs_workshop)),
      songsAfter: sum(rows.map((t) => t.songs_post)),
      newNations: newNationIds.length,
      continents: continents.size,
    };
  });

  const songsWorkshop = sum(done.map((t) => t.songs_workshop));
  const songsAfter = sum(done.map((t) => t.songs_post));
  const reachedIds = [...firsts.keys()];
  const sorted = [...done].sort(newestFirst);
  const oldest = sorted[sorted.length - 1];

  return {
    years,
    total: {
      trainings: done.length,
      trained: sum(done.map((t) => t.people_trained)),
      songsWorkshop,
      songsAfter,
      newNations: reachedIds.length,
      continents: null,
    },
    nationsReached: reachedIds.length,
    tentativeNations: reachedIds
      .map((id) => nationById.get(id))
      .filter((n): n is PwNation => n?.status === "tentative"),
    songsApprox: songsWorkshop + songsAfter,
    librarySongs: input.librarySongs ?? 0,
    openLeads: input.openLeads ?? 0,
    span: sorted.length
      ? { from: { year: oldest.year, month: oldest.month }, to: { year: sorted[0].year, month: sorted[0].month } }
      : null,
    latest: sorted[0] ?? null,
  };
}

/** Leads still to reconnect with: anything not connected or closed. */
export function openLeadCount(leads: readonly { status: string }[]): number {
  return leads.filter((l) => l.status !== "connected" && l.status !== "closed").length;
}

/** Hero bar width, one decimal, e.g. 13/195 = "6.7%". */
export function reachedPercent(reached: number): string {
  return `${Math.min(100, Math.round((reached / WORLD_NATIONS) * 1000) / 10)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(t: { year: number; month: number }): string {
  return `${MONTHS[t.month - 1] ?? "?"} ${t.year}`;
}

/**
 * The hero blurb: tentative nations called out by name, then new nations per
 * year. "Includes Italy, which is tentative. 7 new nations in 2025, 6 in 2026."
 */
export function heroBlurb(totals: OverviewTotals): string {
  const parts: string[] = [];
  const tentative = totals.tentativeNations.map((n) => n.name);
  if (tentative.length === 1) parts.push(`Includes ${tentative[0]}, which is tentative.`);
  else if (tentative.length > 1) parts.push(`Includes ${listText(tentative)}, which are tentative.`);
  const withNew = totals.years.filter((y) => y.newNations > 0);
  if (withNew.length) {
    const [head, ...rest] = withNew;
    const first = `${head.newNations} new ${head.newNations === 1 ? "nation" : "nations"} in ${head.year}`;
    parts.push(`${[first, ...rest.map((y) => `${y.newNations} in ${y.year}`)].join(", ")}.`);
  }
  return parts.join(" ");
}

function listText(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
