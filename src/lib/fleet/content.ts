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
