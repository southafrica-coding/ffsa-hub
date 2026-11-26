import type { PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import { isCompleted, monthKey, newestFirst } from "./overview";

/**
 * Two-letter display codes for the flag tile. Display only: 417 has no
 * iso_code column and this does not add one. Keyed by pw_nations.slug.
 * An unknown slug falls back to the first two letters of the name.
 */
const DISPLAY_CODES: Record<string, string> = {
  "south-africa": "ZA",
  tanzania: "TZ",
  england: "GB",
  "united-kingdom": "GB",
  indonesia: "ID",
  madagascar: "MG",
  burundi: "BI",
  canada: "CA",
  "ivory-coast": "CI",
  "cote-d-ivoire": "CI",
  kenya: "KE",
  nepal: "NP",
  netherlands: "NL",
  paraguay: "PY",
  italy: "IT",
  mozambique: "MZ",
  zimbabwe: "ZW",
  namibia: "NA",
  botswana: "BW",
  uganda: "UG",
  rwanda: "RW",
  malawi: "MW",
  zambia: "ZM",
  ethiopia: "ET",
  nigeria: "NG",
  ghana: "GH",
  india: "IN",
  "united-states": "US",
  usa: "US",
  brazil: "BR",
  germany: "DE",
  france: "FR",
  australia: "AU",
  "new-zealand": "NZ",
};

export function nationCode(nation: Pick<PwNation, "slug" | "name">): string {
  const known = DISPLAY_CODES[nation.slug];
  if (known) return known;
  const letters = nation.name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 2) || "··";
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
  /** Union of the trainings' languages, case-insensitive, sorted. */
  languages: string[];
}

/** Languages a nation's trainings recorded. 417 keeps languages on trainings only. */
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
        languages: nationLanguages(all),
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
