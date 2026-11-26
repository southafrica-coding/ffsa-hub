import type { PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import { monthKey, monthLabel, newestFirst } from "./overview";

/**
 * The card title. A training for one person never shows their name: a
 * blank label, or a label starting "1:1", reads "1:1 training". The import
 * clears personal names from audience_label before it runs.
 */
export function trainingTitle(t: Pick<PwSongwritingTraining, "audience_label">): string {
  const label = t.audience_label?.trim();
  if (!label) return "1:1 training";
  if (/^1\s*:\s*1\b/.test(label)) {
    const rest = label.replace(/^1\s*:\s*1\s*(training)?\s*[·:,-]?\s*/i, "").trim();
    return rest ? `1:1 training · ${rest}` : "1:1 training";
  }
  return label;
}

/** "Potch · South Africa · Oct 2026". */
export function trainingSubline(t: PwSongwritingTraining, nation: PwNation | undefined): string {
  return [t.location_text, nation?.name, monthLabel(t)].filter(Boolean).join(" · ");
}

/** Hatched card: a draft training, or a training in a tentative nation. */
export function isTentativeTraining(t: PwSongwritingTraining, nation: PwNation | undefined): boolean {
  return t.status === "draft" || nation?.status === "tentative";
}

export type TrainingFilter = { kind: "all" } | { kind: "year"; year: number } | { kind: "outside_sa" };

/** South Africa is the home nation for the "Outside SA" filter. */
export function isSouthAfrica(nation: PwNation | undefined): boolean {
  return nation?.slug === "south-africa";
}

export function applyFilter(
  trainings: readonly PwSongwritingTraining[],
  filter: TrainingFilter,
  nationById: Map<string, PwNation>
): PwSongwritingTraining[] {
  switch (filter.kind) {
    case "all":
      return [...trainings];
    case "year":
      return trainings.filter((t) => t.year === filter.year);
    case "outside_sa":
      return trainings.filter((t) => t.nation_id != null && !isSouthAfrica(nationById.get(t.nation_id)));
  }
}

export interface FilterChip {
  key: string;
  label: string;
  count: number;
  filter: TrainingFilter;
}

/** All · N, then each year newest first, then Outside SA. */
export function filterChips(trainings: readonly PwSongwritingTraining[], nationById: Map<string, PwNation>): FilterChip[] {
  const years = [...new Set(trainings.map((t) => t.year))].sort((a, b) => b - a);
  const outside = applyFilter(trainings, { kind: "outside_sa" }, nationById).length;
  return [
    { key: "all", label: "All", count: trainings.length, filter: { kind: "all" } },
    ...years.map((year) => ({
      key: String(year),
      label: String(year),
      count: trainings.filter((t) => t.year === year).length,
      filter: { kind: "year", year } as TrainingFilter,
    })),
    { key: "outside", label: "Outside SA", count: outside, filter: { kind: "outside_sa" } },
  ];
}

export interface MonthGroup {
  key: number;
  label: string;
  trainings: PwSongwritingTraining[];
}

/** Month groups, newest first. */
export function groupByMonth(trainings: readonly PwSongwritingTraining[]): MonthGroup[] {
  const groups = new Map<number, MonthGroup>();
  for (const t of [...trainings].sort(newestFirst)) {
    const key = monthKey(t);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: monthLabel(t), trainings: [] };
      groups.set(key, group);
    }
    group.trainings.push(t);
  }
  return [...groups.values()];
}

/** Count text: null is unknown and shows "?". */
export function countText(value: number | null): string {
  return value == null ? "?" : String(value);
}
