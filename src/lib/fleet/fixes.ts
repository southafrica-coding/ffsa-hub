// "Mark as fixed" (Gideon, 23 Nov 2026; Monitor points too, 25 Nov): a Fix now or Monitor
// point on a vehicle can be marked fixed
// on the vehicle's page, with the date, who fixed it and what was done, without doing a
// whole inspection. The point goes back to OK as of that date; the next inspection that
// checks it overrides it as usual. Deleting an inspection rebuilds the vehicle's condition
// from the remaining inspections, so fixes newer than the rebuilt result are kept.

import type { ConditionEntry, ISODate } from "./rules/types";

export const FIX_LIMITS = { by: 80, work: 300 };

/** The point states that can be marked fixed: Fix now, and Monitor (Gideon, 25 Nov 2026). */
export const FIXABLE = ["fix", "mon"];
export const isFixable = (s: string | null | undefined) => !!s && FIXABLE.includes(s);

/** "Was Fix now (19 Nov 2026): Bushes worn" / "Was Monitor (…): …", for the Condition tab,
 *  History and the report. Older fixes without a state read as Fix now (they all were). */
export function wasLine(was: { s?: string; d?: string; n?: string }, fmt: (d: string) => string): string {
  const label = was.s === "mon" ? "Monitor" : "Fix now";
  return `Was ${label}${was.d ? ` (${fmt(was.d)})` : ""}: ${was.n ?? ""}`;
}

export type FixInput = { itemId: string; date: ISODate; by: string; work: string };

/** The point's condition once marked fixed, or why it can't be. */
export function fixEntry(
  prev: ConditionEntry | undefined,
  input: FixInput,
  today: ISODate,
  recordedBy: string | null,
  now = new Date().toISOString()
): { entry: ConditionEntry } | { error: string } {
  if (!prev || !FIXABLE.includes(prev.s as string)) return { error: "That point isn’t marked Fix now or Monitor." };
  const by = input.by.trim(), work = input.work.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Enter the date it was fixed." };
  if (input.date > today) return { error: "The date it was fixed can’t be in the future." };
  if (prev.d && input.date < prev.d) return { error: `It was found on ${prev.d}, so it can’t have been fixed before then.` };
  if (!by) return { error: "Say who fixed it." };
  if (!work) return { error: "Say what was done." };
  if (by.length > FIX_LIMITS.by || work.length > FIX_LIMITS.work) return { error: "Keep it short." };
  return {
    entry: {
      s: "ok",
      d: input.date,
      n: `Fixed by ${by}: ${work}`,
      p: [],
      t: prev.t,
      f: { by, work, recordedBy, recordedAt: now, was: { s: prev.s, d: prev.d, n: prev.n, i: prev.i } },
    },
  };
}

/** After an inspection is deleted: the rebuilt condition, with each fix kept where it's at
 *  least as new as what the remaining inspections say (a later check still wins). */
export function keepFixes(rebuilt: Record<string, ConditionEntry>, before: Record<string, ConditionEntry> | null | undefined): Record<string, ConditionEntry> {
  const out = { ...rebuilt };
  for (const [id, e] of Object.entries(before || {})) {
    if (!e || !e.f) continue;
    const r = out[id];
    if (!r || (r.d || "") <= (e.d || "")) out[id] = e;
  }
  return out;
}
