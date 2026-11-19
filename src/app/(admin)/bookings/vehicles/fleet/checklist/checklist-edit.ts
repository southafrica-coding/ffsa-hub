// Checklist editing and the weekly/monthly sort, as pure functions on a copy of the
// checklist. Reference: normChecklist, SUGGEST_MONTHLY, setRoutine, sortCounts, the
// cl-* and sort-* handlers and saveChecklist in vehicles-module/app/ffsa-fleet.html.
// Every function returns a new checklist; the one passed in is never changed.

import { inType, TYPES, type Checklist, type ChecklistItem } from "@/lib/fleet/rules";

type Section = Checklist["sections"][number];

export const ROUTINE = ["weekly", "monthly"];

/** Points the app suggests checking once a month: they change slowly. */
export const SUGGEST_MONTHLY = new Set([
  "doc-papers", "doc-insure", "doc-service", "doc-keys", "doc-tracker",
  "ext-front", "ext-rear", "ext-bonnet", "ext-left", "ext-right", "ext-roof", "ext-rust", "ext-seals", "ext-towbar",
  "gls-side", "gls-winders", "gls-rvm",
  "lgt-fog", "lgt-lens", "lgt-cabin", "lgt-reflect",
  "tyr-fl", "tyr-fr", "tyr-rl", "tyr-rr", "tyr-spare", "tyr-wear", "tyr-rims", "tyr-age",
  "eng-ps", "eng-belt", "eng-hoses", "eng-wires",
  "cab-seats", "cab-heat", "cab-fan", "cab-handles", "cab-radio", "cab-usb", "cab-trim",
  "saf-firstaid", "saf-extinguisher", "saf-jack", "saf-vest", "saf-torch", "saf-card",
  "drv-cruise",
]);

const TYPE_IDS = TYPES.map((t) => t.id);

/** A deep copy with every point's checks as a list (old points used a level `l`). */
export function normChecklist(cl: Checklist): Checklist {
  const out = JSON.parse(JSON.stringify(cl)) as Checklist;
  for (const s of out.sections || [])
    for (const it of (s.items || []) as (ChecklistItem & { l?: number })[])
      if (!Array.isArray(it.in)) it.in = it.l === 3 ? ["workshop"] : it.l === 1 ? ["pre", "weekly"] : ["weekly"];
  return out;
}

/** A new id, like the app's uid('x'). */
export const newId = (prefix: string) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function mapItem(cl: Checklist, si: number, ii: number, f: (it: ChecklistItem) => ChecklistItem): Checklist {
  return {
    ...cl,
    sections: cl.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map((it, j) => (j !== ii ? it : f(it))) })),
  };
}
function mapSection(cl: Checklist, si: number, f: (s: Section) => Section): Checklist {
  return { ...cl, sections: cl.sections.map((s, i) => (i === si ? f(s) : s)) };
}
function mapAll(cl: Checklist, f: (it: ChecklistItem) => ChecklistItem): Checklist {
  return { ...cl, sections: cl.sections.map((s) => ({ ...s, items: s.items.map(f) })) };
}

// ── Weekly or monthly ──────────────────────────────────────

/** Put a point in the weekly or the monthly check, keeping its other checks. */
export function setRoutine(it: ChecklistItem, f: "weekly" | "monthly"): ChecklistItem {
  const set = new Set((it.in || []).filter((x) => !ROUTINE.includes(x)));
  set.add(f);
  return { ...it, in: TYPE_IDS.filter((x) => set.has(x)) };
}

/** How often a point is checked, for the sort screen. */
export const routineOf = (it: ChecklistItem): "weekly" | "monthly" => ((it.in || []).includes("weekly") ? "weekly" : "monthly");

export function setRoutineById(cl: Checklist, id: string, f: "weekly" | "monthly"): Checklist {
  return mapAll(cl, (it) => (it.id === id ? setRoutine(it, f) : it));
}

/** "Use all suggestions": every routine point weekly, except the suggested ones. */
export const applySuggestions = (cl: Checklist): Checklist =>
  mapAll(cl, (it) => (inType(it, "monthly") ? setRoutine(it, SUGGEST_MONTHLY.has(it.id) ? "monthly" : "weekly") : it));

/** "Make all weekly". */
export const allWeekly = (cl: Checklist): Checklist => mapAll(cl, (it) => (inType(it, "monthly") ? setRoutine(it, "weekly") : it));

/** Points every week, and how many more once a month. */
export function sortCounts(cl: Checklist) {
  let w = 0,
    m = 0;
  for (const s of cl.sections)
    for (const it of s.items) {
      const i = it.in || [];
      if (i.includes("weekly")) w++;
      else if (i.includes("monthly")) m++;
    }
  return { w, m };
}

// ── Edit checklist ─────────────────────────────────────────

export const setSectionName = (cl: Checklist, si: number, name: string) => mapSection(cl, si, (s) => ({ ...s, name }));

export const setItemText = (cl: Checklist, si: number, ii: number, key: "t" | "h", value: string) =>
  mapItem(cl, si, ii, (it) => ({ ...it, [key]: value }));

/** Tick or untick one check for a point; the list stays in the checks' order. */
export function setItemType(cl: Checklist, si: number, ii: number, type: string, on: boolean): Checklist {
  return mapItem(cl, si, ii, (it) => {
    const set = new Set(it.in || []);
    if (on) set.add(type);
    else set.delete(type);
    return { ...it, in: TYPE_IDS.filter((x) => set.has(x)) };
  });
}

export const blankItem = (id = newId("x")): ChecklistItem => ({ id, t: "", in: ["weekly"], h: "" });

export const addItem = (cl: Checklist, si: number, id?: string) => mapSection(cl, si, (s) => ({ ...s, items: [...s.items, blankItem(id)] }));

export const removeItem = (cl: Checklist, si: number, ii: number) =>
  mapSection(cl, si, (s) => ({ ...s, items: s.items.filter((_, j) => j !== ii) }));

export const addSection = (cl: Checklist, id = newId("s"), itemId?: string): Checklist => ({
  ...cl,
  sections: [...cl.sections, { id, name: "New section", items: [blankItem(itemId)] }],
});

export const removeSection = (cl: Checklist, si: number): Checklist => ({ ...cl, sections: cl.sections.filter((_, i) => i !== si) });

/** Ready to save (the app's saveChecklist): names and wording trimmed, points with no
 *  wording and sections with no points left out. */
export function cleanChecklist(cl: Checklist): { checklist: Checklist } | { error: string } {
  const sections = cl.sections
    .map((s) => ({
      ...s,
      name: (s.name || "").trim() || "Untitled section",
      items: s.items.filter((it) => (it.t || "").trim()).map((it) => ({ ...it, t: it.t.trim(), h: (it.h || "").trim() })),
    }))
    .filter((s) => s.items.length);
  if (!sections.length) return { error: "The checklist needs at least one point." };
  return { checklist: { sections } };
}

/** The points shown for a filter ("" = all). */
export const visibleItems = (s: Section, filter: string) => (filter ? s.items.filter((it) => inType(it, filter)) : s.items);
