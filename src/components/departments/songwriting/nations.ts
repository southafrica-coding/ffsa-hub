import type { PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import { isCompleted, monthKey, newestFirst } from "./overview";

/**
 * Two-letter code for the flag tile: pw_nations.iso_code (424) when set,
 * else the first two letters of the name.
 */
export function nationCode(nation: Pick<PwNation, "name"> & { iso_code?: string | null }): string {
  const iso = nation.iso_code?.trim().toUpperCase();
  if (iso) return iso;
  const letters = nation.name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 2) || "··";
}

/**
 * A nation's languages: the ones stored on the nation (424) when there are
 * any, else the union of its trainings' languages.
 */
export function languagesForNation(
  nation: Pick<PwNation, "id"> & { languages?: string[] | null },
  trainings: readonly PwSongwritingTraining[]
): string[] {
  const stored = (nation.languages ?? []).map((l) => l.trim()).filter(Boolean);
  if (stored.length) return stored;
  return nationLanguages(trainings.filter((t) => t.nation_id === nation.id));
}

export interface NationSummary {
  nation: PwNation;
  trainings: number;
  trained: number;
  /** Some training had an unknown count: show "42+" or "?". */
  trainedUnknown: boolean;
  songs: number;
  first: PwSongwritingTraining | null;
  latest: PwSongwritingTraining | null;
  /** The nation's stored languages, or (none stored) the union of its trainings' languages. */
  languages: string[];
}

/** Languages a nation's trainings recorded: case-insensitive union, sorted. */
export function nationLanguages(trainings: readonly PwSongwritingTraining[]): string[] {
  const seen = new Map<string, string>();
  for (const t of trainings) {
    for (const raw of t.languages ?? []) {
      const lang = raw.trim();
      if (lang && !seen.has(lang.toLowerCase())) seen.set(lang.toLowerCase(), lang);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function summariseNations(
  nations: readonly PwNation[],
  trainings: readonly PwSongwritingTraining[]
): NationSummary[] {
  return nations
    .map((nation) => {
      const all = trainings.filter((t) => t.nation_id === nation.id);
      const done = all.filter(isCompleted).sort(newestFirst);
      return {
        nation,
        trainings: done.length,
        trained: done.reduce((acc, t) => acc + (t.people_trained ?? 0), 0),
        trainedUnknown: done.some((t) => t.people_trained == null),
        songs: done.reduce((acc, t) => acc + (t.songs_workshop ?? 0) + (t.songs_post ?? 0), 0),
        first: done[done.length - 1] ?? null,
        latest: done[0] ?? null,
        languages: languagesForNation(nation, all),
      };
    })
    .sort(
      (a, b) =>
        // Tentative last, then most trainings, then earliest first training, then name.
        Number(a.nation.status === "tentative") - Number(b.nation.status === "tentative") ||
        b.trainings - a.trainings ||
        (a.first && b.first ? monthKey(a.first) - monthKey(b.first) : 0) ||
        a.nation.name.localeCompare(b.nation.name)
    );
}

/** "42+" when some counts are unknown, "?" when all are. */
export function trainedText(summary: Pick<NationSummary, "trained" | "trainedUnknown" | "trainings">): string {
  if (!summary.trainedUnknown) return String(summary.trained);
  return summary.trained > 0 ? `${summary.trained}+` : "?";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
