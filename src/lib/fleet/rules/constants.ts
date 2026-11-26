// Rule numbers and vocabularies (SPEC section 6). Read from docs/content/rules.json so the
// numbers live in one place; the names match the reference app's constants.

import rules from "../content/rules.json";
import checklistContent from "../content/checklist.json";

/** A bumper-to-bumper inspection every 5 000 km, a service every 10 000 km, warn 500 km before. */
export const KM_RULES = rules.kmRules as { inspect: number; service: number; warn: number };
export const EST_MIN = rules.estimatedMinutes as Record<string, number>;
export const RECORD_KINDS = rules.workshopVisitKinds as string[];
export const B2B_KIND = RECORD_KINDS[0]; // "Workshop inspection (bumper to bumper)"
export const VSTATUS = rules.vehicleStatuses as string[];
export const AWAY = ["On a trip", "In workshop"];
export const NOT_IN_USE = ["For sale", "Off the road"];
export const REPAIR_KINDS = ["Service", "Mechanical repair", "Body repair", "Tyres", "Insurance claim", "Other"];
export const CAL_DAYS = rules.calendarDays as number;
/** A gap longer than this between taps counts as this much (e.g. the road test). */
export const TIME_CAP_MS = (rules.idleCapMinutes as number) * 60e3;
/** Bumped when the in-car guide's text changes, so printed guides show as out of date. */
export const CARDVER = 2;

export const STATUS: Record<string, string> = { ok: "OK", mon: "Monitor", fix: "Fix now", na: "N/A" };
export const SEV_RANK: Record<string, number> = { crit: 0, warn: 1, info: 2 };

export interface CheckType {
  id: string;
  label: string;
  short: string;
  desc: string;
  help: string;
}
export const TYPES = checklistContent.checkTypes as CheckType[];
const TYPE: Record<string, CheckType> = Object.fromEntries(TYPES.map((t) => [t.id, t]));
const TYPE_ALIAS: Record<string, string> = { trip: "pre" };
export const typeOf = (id?: string | null): CheckType =>
  (id && (TYPE[id] || TYPE[TYPE_ALIAS[id]])) || { id: "other", label: "Inspection", short: "Inspection", desc: "", help: "" };
