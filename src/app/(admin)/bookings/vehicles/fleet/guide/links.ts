// Where a tutorial step's "Open it" goes. The Guide content uses the Fleet app's
// links: hash links ("#today", "#v-{v}", "#calendar", "#guide-tutorial", …) and the
// screen keys of guide-hub.json ("today", "vehicle", "calendar", …). Both map to Hub
// routes here.
//
// Today, Calendar and Schedule are their own screens (added in vehicles-module/
// HUB-PLAN.md, PR 3); they're in PENDING below.

import { FLEET, vehicleHref } from "../_components/ui";
import { guideText, type GuideTokens } from "@/lib/fleet/guide";

const VEHICLES = `${FLEET}/vehicles`;

/** Today, Calendar and Schedule (added in PR 3). Kept as a named map for links.test.ts. */
export const PENDING: Record<string, string> = {
  today: FLEET,
  calendar: `${FLEET}/calendar`,
  schedule: `${FLEET}/schedule`,
};

const SCREENS: Record<string, string> = {
  ...PENDING,
  vehicles: VEHICLES,
  fleet: VEHICLES,
  workshops: `${FLEET}/workshops`,
  providers: `${FLEET}/workshops`,
  checklist: `${FLEET}/checklist`,
  settings: `${FLEET}/settings`,
  guide: `${FLEET}/guide`,
};

export const guidePageHref = (id?: string | null) => (id ? `${FLEET}/guide?page=${encodeURIComponent(id)}` : `${FLEET}/guide`);

/** The Hub route for a Guide link, or null when there is nowhere to send it (no
 *  vehicle yet for "{v}", or a screen the Hub doesn't have, such as Ask). */
export function guideHref(link: string | undefined | null, tk: GuideTokens): string | null {
  if (!link) return null;
  if (link.includes("{v}") && !tk.v) return null;
  const h = decodeURIComponent(guideText(link, tk).replace(/^#/, "").trim());
  if (!h) return null;
  if (h === "vehicle") return tk.v ? vehicleHref(String(tk.v)) : null;
  if (h.startsWith("v-")) return h.length > 2 ? vehicleHref(h.slice(2)) : null;
  if (h.startsWith("inspect-")) return h.length > 8 ? `${vehicleHref(h.slice(8))}/inspect` : null;
  if (h.startsWith("i-")) return h.length > 2 ? `${FLEET}/inspections/${h.slice(2)}` : null;
  if (h.startsWith("guide-")) return guidePageHref(h.slice(6));
  return SCREENS[h] ?? null;
}
