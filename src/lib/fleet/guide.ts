// The Fleet Guide (vehicles-module/docs/SPEC.md section 8): tokens filled from live
// settings, tutorial step keys and What's new dates. Reference: guideTokens, guideText,
// blocksHTML and guideView in vehicles-module/app/ffsa-fleet.html.

import guideContent from "./content/guide-hub.json";
import { KM_RULES, fmtDate, fmtKm, inUse, itemsFor, schedule, TYPES, type FleetData } from "./rules";

export type GuideStep = [title: string, text: string, link?: string, action?: string, actionLabel?: string];
export type GuideBlock =
  | { h: string }
  | { p: string }
  | { ul: string[] }
  | { steps: GuideStep[] }
  | { changes: true };
export interface GuidePage {
  id: string;
  title: string;
  intro?: string;
  blocks: GuideBlock[];
}
export interface Guide {
  pages: GuidePage[];
  /** Newest first: [date (YYYY-MM-DD, or a placeholder such as "go-live"), text]. */
  changes: [string, string][];
}

export const GUIDE = guideContent as unknown as Guide;

const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type GuideTokens = Record<string, string | number>;

/** The live values the Guide's {braces} stand for (the app's guideTokens). */
export function guideTokens(F: FleetData): GuideTokens {
  const sc = schedule(F);
  const tc = Object.fromEntries(TYPES.map((t) => [t.id, itemsFor(F.checklist, t.id).length]));
  const vs = F.vehicles.filter(inUse);
  const days = sc.days.map((d) => DAYS_LONG[d - 1] + "s");
  const budgetMins = Number((F.schedule && F.schedule.budgetHours) || 5) * 60;
  return {
    pre: tc.pre,
    post: tc.post,
    weekly: tc.weekly,
    monthly: tc.monthly,
    workshop: tc.workshop,
    days: days.length < 2 ? days.join("") : days.slice(0, -1).join(", ") + " and " + days[days.length - 1],
    max: sc.max,
    inspectKm: fmtKm(KM_RULES.inspect),
    serviceKm: fmtKm(KM_RULES.service),
    warnKm: fmtKm(KM_RULES.warn),
    budget: budgetMins / 60 + " hours",
    v: vs[0] ? vs[0].id : "",
  };
}

/** Fill {tokens}; unknown ones are left as written (the app's guideText). */
export const guideText = (s: string, tk: GuideTokens): string =>
  String(s).replace(/\{(\w+)\}/g, (m, k) => (tk[k] !== undefined ? String(tk[k]) : m));

/** The page for ?page=…, or the first one. */
export function guidePage(id?: string | null): { page: GuidePage; prev?: GuidePage; next?: GuidePage } {
  const i = Math.max(0, GUIDE.pages.findIndex((p) => p.id === id));
  return { page: GUIDE.pages[i], prev: GUIDE.pages[i - 1], next: GUIDE.pages[i + 1] };
}

const isIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** "17 Nov 2026"; a placeholder such as "go-live" reads "Go-live". */
export const changeDate = (d: string): string => (isIso(d) ? fmtDate(d) : d.charAt(0).toUpperCase() + d.slice(1));

/** "Last updated …": the newest dated entry in What's new. */
export function lastUpdated(changes: [string, string][] = GUIDE.changes): string {
  const d = changes.find(([x]) => isIso(x));
  return d ? fmtDate(d[0]) : "";
}

/** A tutorial step's stable key for per-user progress: its title as a slug, so ticks
 *  survive steps being added or reordered (the app keyed them by position). */
export const stepKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

/** Every tutorial step in the Guide, in order. */
export function tutorialSteps(guide: Guide = GUIDE): GuideStep[] {
  const out: GuideStep[] = [];
  for (const p of guide.pages) for (const b of p.blocks) if ("steps" in b) out.push(...b.steps);
  return out;
}
