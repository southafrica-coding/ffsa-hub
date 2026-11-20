// Fleet content (vehicles-module/docs/content, copied as-is into ./content).

import checklistContent from "./content/checklist.json";
import type { Checklist } from "./rules/types";

interface ContentItem {
  id: string;
  section: string;
  sectionName: string;
  text: string;
  hint?: string;
  checks?: string[];
  measure?: unknown;
}

/** FFSA's checklist as the app's DEFAULT_CHECKLIST: used until settings hold the live one. */
export function defaultChecklist(): Checklist {
  const sections: Checklist["sections"] = [];
  for (const it of checklistContent.items as ContentItem[]) {
    let sec = sections.find((s) => s.id === it.section);
    if (!sec) sections.push((sec = { id: it.section, name: it.sectionName, items: [] }));
    sec.items.push({ id: it.id, t: it.text, h: it.hint || "", in: it.checks || [], ...(it.measure ? { m: it.measure } : {}) });
  }
  return { sections };
}

/** The workshop's 25-point check (Motech's sheet, Gideon 20 Nov 2026): its own section. */
export const WORKSHOP_25_SECTION = "m25";

/**
 * A checklist with the workshop's 25-point check added when it isn't there yet. The old
 * Fleet app's live checklist predates it, so the import adds it rather than drop it.
 * Nothing else in the checklist changes.
 */
export function withWorkshop25(cl: Checklist): Checklist {
  if (cl.sections.some((s) => s.id === WORKSHOP_25_SECTION)) return cl;
  const sheet = defaultChecklist().sections.find((s) => s.id === WORKSHOP_25_SECTION);
  if (!sheet) return cl;
  const taken = new Set(cl.sections.flatMap((s) => s.items.map((i) => i.id)));
  const items = sheet.items.filter((i) => !taken.has(i.id));
  return items.length ? { ...cl, sections: [...cl.sections, { ...sheet, items }] } : cl;
}
