// "Why and how" for each checklist point, from src/lib/fleet/content/checklist.json
// (the Fleet app's HELP and GUIDE text).

import checklistContent from "@/lib/fleet/content/checklist.json";

export interface PointHelp {
  why?: string;
  safetyFirst?: string;
  looksLike?: string;
  howToCheck?: string[];
  whatGoesWrong?: { problem: string; signs: string }[];
  markOk?: string;
  markMonitor?: string;
  markFixNow?: string;
}

const ALL: Record<string, PointHelp> = Object.fromEntries(
  (checklistContent.items as { id: string; help?: PointHelp | null }[]).filter((it) => it.help).map((it) => [it.id, it.help as PointHelp])
);

/** Help for the given point ids (points added by hand have none). */
export function helpFor(ids: string[]): Record<string, PointHelp> {
  const out: Record<string, PointHelp> = {};
  for (const id of ids) if (ALL[id]) out[id] = ALL[id];
  return out;
}

/** The checklist.json flag behind the app's "Suggested: monthly". */
export const suggestedInContent = () =>
  (checklistContent.items as { id: string; suggestMonthly?: boolean }[]).filter((it) => it.suggestMonthly).map((it) => it.id);
