// The inspection, as pure functions: the draft (newDraft, loadDraft, tickDraft), the
// step-by-step route (guidedSteps), measurement grading (autoStatus), what a save stores
// and how it changes the vehicle (buildInspection, vehiclePatchAfterSave), what a delete
// recalculates (recomputeVehicle), and the report text (reportText).
// Reference: newDraft, loadDraft, tickDraft, guidedSteps, autoStatus, saveInspection,
// recomputeVehicle, reportText in vehicles-module/app/ffsa-fleet.html. Field names are the
// Fleet app's (SPEC section 4); inspectionToRow / inspectionFromRow map them to columns.

import checklistContent from "./content/checklist.json";
import {
  STATUS,
  TIME_CAP_MS,
  checklistIndex,
  fmtDate,
  fmtKm,
  has,
  inType,
  itemsFor,
  odoPatch,
  profileOf,
  typeOf,
  type Checklist,
  type FleetVehicle,
  type ISODate,
  type PointState,
} from "./rules";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ROUTINE = ["weekly", "monthly"];
export const FUEL = ["Empty", "¼", "½", "¾", "Full"];
/** The six walk-around photos, the same angles every time. */
export const SLOTS = checklistContent.walkAroundPhotos as [string, string][];
export const SLOTNAME: Record<string, string> = Object.fromEntries(SLOTS);

export interface RouteStage {
  id: string;
  title: string;
  instructions: string;
  photos: boolean;
  items: string[];
}
/** The walk-around order of the step-by-step inspection (the app's ROUTE). */
export const ROUTE = checklistContent.route as RouteStage[];

/** localStorage key of a vehicle's draft. The vehicle page reads it for "Continue draft". */
export const draftKey = (vehicleId: string) => `ffsa-fleet-draft-${vehicleId}`;

export type InspType = "pre" | "post" | "weekly" | "monthly" | "workshop";
export const INSP_TYPES: InspType[] = ["pre", "post", "weekly", "monthly", "workshop"];

export interface DraftResult {
  s?: PointState | null;
  v?: string;
  n?: string;
  p?: string[];
}
export interface DocFile {
  id: string;
  name?: string;
  type?: string;
}

export interface Draft {
  vehicleId: string;
  type: InspType;
  date: ISODate;
  odometer: string;
  fuel: string;
  inspector: string;
  provider: string;
  /** Post-trip: the Hub booking it follows (the app's free-text `trip`). */
  bookingId: string;
  results: Record<string, DraftResult>;
  walk: Record<string, string>;
  extra: string[];
  docs: DocFile[];
  summary: string;
  /** Which sections (full list) and notes are open. */
  open: Record<string, boolean>;
  gstep: number;
  startedAt: string;
  /** Active time so far (tickDraft). */
  activeMs: number;
  tick: number;
  /** When this copy was last written (ms), to pick the newer of the device and server copies. */
  savedAt?: number;
}

const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
const FILE_ID = /^[0-9a-f]{32}$/;
const fileIds = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && FILE_ID.test(x)).slice(0, max) : [];
export const asType = (t: unknown): InspType => {
  const id = typeOf(typeof t === "string" ? t : "weekly").id;
  return (INSP_TYPES as string[]).includes(id) ? (id as InspType) : "weekly";
};

/** A fresh draft. Points the model doesn't have are pre-marked N/A. */
export function newDraft(
  v: FleetVehicle,
  type: string | null | undefined,
  today: ISODate,
  inspector = "",
  now = Date.now()
): Draft {
  const pr = profileOf(v);
  const results: Record<string, DraftResult> = {};
  ((pr && pr.na) || []).forEach((id) => {
    results[id] = { s: "na", p: [] };
  });
  return {
    vehicleId: v.id,
    type: asType(type || "weekly"),
    date: today,
    odometer: "",
    fuel: "",
    inspector,
    provider: "",
    bookingId: "",
    results,
    walk: {},
    extra: [],
    docs: [],
    summary: "",
    open: {},
    gstep: 0,
    startedAt: new Date(now).toISOString(),
    activeMs: 0,
    tick: now,
    savedAt: now,
  };
}

/** A stored draft (device or server copy) made safe to use, or null. The app's loadDraft. */
export function loadDraft(raw: unknown, vehicleId: string): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, any>;
  if (d.vehicleId && d.vehicleId !== vehicleId) return null;
  const results: Record<string, DraftResult> = {};
  if (d.results && typeof d.results === "object")
    for (const [id, r] of Object.entries(d.results as Record<string, any>)) {
      if (!r || typeof r !== "object") continue;
      results[id] = {
        s: r.s && STATUS[r.s] ? r.s : null,
        ...(has(r.v) ? { v: String(r.v).slice(0, 20) } : {}),
        ...(r.n ? { n: str(r.n) } : {}),
        p: fileIds(r.p),
      };
    }
  const walk: Record<string, string> = {};
  if (d.walk && typeof d.walk === "object")
    for (const [k] of SLOTS) if (typeof d.walk[k] === "string" && FILE_ID.test(d.walk[k])) walk[k] = d.walk[k];
  return {
    vehicleId,
    type: asType(d.type),
    date: str(d.date, 10),
    odometer: str(d.odometer, 20),
    fuel: FUEL.includes(d.fuel) ? d.fuel : "",
    inspector: str(d.inspector, 200),
    provider: str(d.provider, 200),
    bookingId: str(d.bookingId, 40),
    results,
    walk,
    extra: fileIds(d.extra),
    docs: Array.isArray(d.docs)
      ? d.docs
          .filter((f: any) => f && typeof f.id === "string" && FILE_ID.test(f.id))
          .map((f: any) => ({ id: f.id, name: str(f.name, 200), type: str(f.type, 100) }))
      : [],
    summary: str(d.summary),
    open: d.open && typeof d.open === "object" ? Object.fromEntries(Object.entries(d.open).map(([k, x]) => [k, !!x])) : {},
    gstep: Math.max(0, Math.floor(Number(d.gstep) || 0)),
    startedAt: str(d.startedAt, 40),
    activeMs: Math.max(0, Number(d.activeMs) || 0),
    tick: Number(d.tick) || 0,
    savedAt: Number(d.savedAt) || 0,
  };
}

/** The newer of the device and server copies (by savedAt); either may be missing. */
export function newerDraft(a: Draft | null, b: Draft | null): Draft | null {
  if (!a) return b;
  if (!b) return a;
  return (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
}

/** The time tracker (SPEC 6.10): active time while the form is used; a gap longer than
 *  10 minutes between taps counts as 10. Mutates and returns the draft, as the app. */
export function tickDraft<T extends { activeMs?: number; tick?: number }>(d: T, now = Date.now()): T {
  if (d.tick) {
    const dt = now - d.tick;
    if (dt > 0) d.activeMs = (d.activeMs || 0) + Math.min(dt, TIME_CAP_MS);
  }
  d.tick = now;
  return d;
}

/** Minutes saved with the inspection: at least 1. */
export const draftMins = (activeMs: number) => Math.max(1, Math.round((Number(activeMs) || 0) / 60000));

/** "182 340" → 182340 (digits only, as the app's toKm). */
export function toKm(v: unknown): number | null {
  if (!has(v)) return null;
  const s = String(v).replace(/\D/g, "");
  return s ? Number(s) : null;
}
/** "2,5" → 2.5 (the app's toNum). */
export function toNum(v: unknown): number | null {
  if (!has(v)) return null;
  let s = String(v).replace(/[\s  ]/g, "");
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export interface Measure {
  u: string;
  w?: number | null;
  f?: number | null;
}
/** Measurements are graded automatically: under f is Fix now, under w is Monitor. */
export function autoStatus(m: Measure | null | undefined, val: unknown): PointState | null {
  const n = toNum(val);
  if (n === null || !m || !has(m.f)) return null;
  return n < Number(m.f) ? "fix" : has(m.w) && n < Number(m.w) ? "mon" : "ok";
}

// ── Step by step ───────────────────────────────────────────

export type Step =
  | { k: "ready"; st?: undefined }
  | { k: "attn"; st?: undefined }
  | { k: "photos"; st: number }
  | { k: "item"; id: string; st: number; first: boolean }
  | { k: "finish"; st?: undefined };

/** Get ready → (Keep an eye on) → each stage of the route, with the walk-around photos at
 *  the start of "Walk around the outside" → points not on the route → Finish. */
export function guidedSteps(cl: Checklist, type: string, v: FleetVehicle, hasAttention: boolean): Step[] {
  const pr = profileOf(v);
  const na = new Set((pr && pr.na) || []);
  const ix = checklistIndex(cl);
  const steps: Step[] = [{ k: "ready" }];
  if (type !== "pre" && type !== "workshop" && hasAttention) steps.push({ k: "attn" });
  const seen = new Set<string>();
  ROUTE.forEach((st, si) => {
    const ids = st.items.filter((id) => ix[id] && inType(ix[id], type));
    ids.forEach((i) => seen.add(i));
    const show = ids.filter((id) => !na.has(id));
    const photos = st.photos && type !== "pre";
    if (photos && show.length) steps.push({ k: "photos", st: si });
    show.forEach((id, j) => steps.push({ k: "item", id, st: si, first: j === 0 && !photos }));
  });
  itemsFor(cl, type)
    .filter((id) => !seen.has(id))
    .forEach((id, j) => steps.push({ k: "item", id, st: -1, first: j === 0 }));
  steps.push({ k: "finish" });
  return steps;
}

/** The stages for "Jump to…": [stage index (-1 = other points), first step number]. */
export function guidedStages(steps: Step[]): { st: number; n: number }[] {
  const out: { st: number; n: number }[] = [];
  steps.forEach((x, n) => {
    if (x.st !== undefined && !out.some((y) => y.st === x.st)) out.push({ st: x.st, n });
  });
  return out;
}
export const OTHER_STAGE = { title: "Other points", instructions: "Points added to the checklist for FFSA." };
export const stageOf = (st: number) => (st >= 0 ? ROUTE[st] : OTHER_STAGE);

export function progress(cl: Checklist, d: Pick<Draft, "type" | "results">) {
  const ids = itemsFor(cl, d.type);
  let done = 0,
    fix = 0,
    mon = 0;
  for (const id of ids) {
    const s = d.results[id] && d.results[id].s;
    if (s) {
      done++;
      if (s === "fix") fix++;
      if (s === "mon") mon++;
    }
  }
  return { done, total: ids.length, fix, mon };
}

/** The save bar's note (the app's updateProgress). */
export const saveNote = (done: number, total: number) =>
  done === total
    ? "All points checked. Draft is kept on this device until you save."
    : `${total - done} points still unchecked; they keep their previous result. Draft is kept on this device until you save.`;

// ── Save ───────────────────────────────────────────────────

export interface StoredResult {
  s: PointState | null;
  v: string;
  n: string;
  p: string[];
  t: string;
  sec: string;
}
export type Counts = { ok: number; mon: number; fix: number; na: number };

/** An inspection in the app's field names. */
export interface Inspection {
  id?: string;
  vehicleId: string;
  type: InspType;
  date: ISODate;
  odometer: number;
  fuel: string;
  inspector: string;
  provider: string;
  bookingId: string | null;
  docs: DocFile[];
  results: Record<string, StoredResult>;
  walk: Record<string, string>;
  extra: string[];
  summary: string;
  counts: Counts;
  mins: number | null;
  startedAt: string;
  createdAt?: string;
  createdBy?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** What saveInspection stores, or the message the app shows. Only points in the chosen
 *  check are kept, each with its wording and section at the time. */
export function buildInspection(
  cl: Checklist,
  raw: unknown,
  opts: { vehicleId: string; today: ISODate }
): { error: string } | { doc: Inspection } {
  const d = loadDraft(raw, opts.vehicleId);
  if (!d) return { error: "Expected a draft inspection." };
  if (!d.date || !ISO.test(d.date)) return { error: "Enter the date of the inspection." };
  if (d.date > opts.today) return { error: "The date can't be in the future." };
  const odo = toKm(d.odometer);
  if (odo === null || odo <= 0) return { error: "Enter the odometer reading in km." };
  const visible = new Set(itemsFor(cl, d.type));
  const ix = checklistIndex(cl);
  const results: Record<string, StoredResult> = {};
  const counts: Counts = { ok: 0, mon: 0, fix: 0, na: 0 };
  for (const [id, r] of Object.entries(d.results)) {
    if (!r || !visible.has(id)) continue;
    if (!r.s && !r.n && !(r.p && r.p.length) && !has(r.v)) continue;
    results[id] = {
      s: r.s || null,
      v: has(r.v) ? String(r.v) : "",
      n: r.n || "",
      p: r.p || [],
      t: ix[id] ? ix[id].t : id,
      sec: ix[id] ? ix[id].secName : "",
    };
    if (r.s) counts[r.s]++;
  }
  if (!Object.values(results).some((r) => r.s)) return { error: "Mark at least one point before saving." };
  // An hour-long road test still counts at most 10 minutes per gap; 12 hours is a sanity cap.
  const mins = draftMins(Math.min(d.activeMs, 12 * 3600e3));
  return {
    doc: {
      vehicleId: opts.vehicleId,
      type: d.type,
      date: d.date,
      odometer: odo,
      fuel: d.fuel || "",
      inspector: (d.inspector || "").trim(),
      provider: d.type === "workshop" ? d.provider || "" : "",
      bookingId: d.type === "post" && UUID.test(d.bookingId) ? d.bookingId : null,
      docs: d.type === "workshop" ? d.docs || [] : [],
      results,
      walk: d.walk || {},
      extra: d.extra || [],
      summary: (d.summary || "").trim(),
      counts,
      mins,
      startedAt: d.startedAt || "",
    },
  };
}

export interface LastRef {
  id?: string;
  date?: ISODate;
  type?: string;
  counts?: Partial<Counts>;
}

/** How a saved inspection changes the vehicle, in the app's field names: condition per
 *  point (unless a later inspection already set it), odometer, lastInspection, lastCheck
 *  (weekly/monthly), lastMonthly, lastPost, and On a trip → In service after a post-trip
 *  check. `condition` is the whole merged object (the app's update deep-merges it). */
export function vehiclePatchAfterSave(
  v: FleetVehicle,
  lastInspection: LastRef | null | undefined,
  doc: Inspection,
  id: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const cond: Record<string, unknown> = {};
  for (const [iid, r] of Object.entries(doc.results)) {
    if (!r.s) continue;
    const prev = v.condition && v.condition[iid];
    if (!prev || (prev.d || "") <= doc.date) cond[iid] = { s: r.s, d: doc.date, v: r.v, n: r.n, p: r.p.slice(0, 6), i: id, t: r.t };
  }
  if (Object.keys(cond).length) patch.condition = { ...(v.condition || {}), ...cond };
  Object.assign(patch, odoPatch(v, doc.odometer, doc.date));
  if (!lastInspection || (lastInspection.date || "") <= doc.date)
    patch.lastInspection = { id, date: doc.date, type: doc.type, counts: doc.counts };
  if (ROUTINE.includes(doc.type) && (!v.lastCheck || (v.lastCheck.date || "") <= doc.date))
    patch.lastCheck = { id, date: doc.date, type: doc.type };
  if (doc.type === "monthly" && (!v.lastMonthly || (v.lastMonthly.date || "") <= doc.date)) patch.lastMonthly = { id, date: doc.date };
  if (doc.type === "post") patch.lastPost = { id, date: doc.date };
  if (doc.type === "post" && v.status === "On a trip") {
    patch.status = "In service";
    patch.statusSince = doc.date;
  }
  return patch;
}

/** After a delete: condition, lastInspection, lastCheck and lastMonthly worked out again
 *  from the remaining inspections, oldest first (the app's recomputeVehicle). */
export function recomputeVehicle(list: Pick<Inspection, "id" | "type" | "date" | "results" | "counts" | "createdAt">[]) {
  const sorted = list
    .slice()
    .sort((a, b) => ((a.date || "") + (a.createdAt || "")).localeCompare((b.date || "") + (b.createdAt || "")));
  const cond: Record<string, unknown> = {};
  let lastI: LastRef | null = null,
    lastC: LastRef | null = null,
    lastM: LastRef | null = null;
  for (const ins of sorted) {
    for (const [iid, r] of Object.entries(ins.results || {}))
      if (r.s) cond[iid] = { s: r.s, d: ins.date, v: r.v ?? "", n: r.n || "", p: (r.p || []).slice(0, 6), i: ins.id, t: r.t };
    lastI = { id: ins.id, date: ins.date, type: ins.type, counts: ins.counts || {} };
    if (ROUTINE.includes(typeOf(ins.type).id)) lastC = { id: ins.id, date: ins.date, type: ins.type };
    if (typeOf(ins.type).id === "monthly") lastM = { id: ins.id, date: ins.date };
  }
  return { condition: cond, lastInspection: lastI, lastCheck: lastC, lastMonthly: lastM };
}

// ── Report text ────────────────────────────────────────────

/** "Copy report text" (the app's reportText). `trip` is the booking's name, if any. */
export function reportText(
  ins: Inspection,
  v: { name: string; reg?: string | null } | null | undefined,
  cl: Checklist,
  trip?: string | null
): string {
  const vv = v || { name: "Vehicle" };
  const ix = checklistIndex(cl);
  const t = typeOf(ins.type);
  const L: string[] = [];
  L.push(`${t.label}: ${vv.name}${vv.reg ? " (" + vv.reg + ")" : ""}`);
  L.push(
    `${fmtDate(ins.date)} · ${fmtKm(ins.odometer)}${trip ? " · " + trip : ""}${ins.inspector ? " · by " + ins.inspector : ""}${ins.provider ? " · " + ins.provider : ""}`
  );
  const c: Partial<Counts> = ins.counts || {};
  L.push(`Result: ${c.fix || 0} fix now, ${c.mon || 0} monitor, ${c.ok || 0} OK${c.na ? ", " + c.na + " N/A" : ""}`);
  const unit = (iid: string) => {
    const m = ix[iid] && (ix[iid].m as Measure | undefined);
    return m ? " " + m.u : "";
  };
  const line = (iid: string, r: StoredResult) => `- ${r.t}${has(r.v) ? ": " + r.v + unit(iid) : ""}${r.n ? ". " + r.n : ""}`;
  const res = Object.entries(ins.results || {});
  const fix = res.filter(([, r]) => r.s === "fix"),
    mon = res.filter(([, r]) => r.s === "mon");
  if (fix.length) {
    L.push("", "FIX NOW");
    fix.forEach(([i, r]) => L.push(line(i, r)));
  }
  if (mon.length) {
    L.push("", "MONITOR");
    mon.forEach(([i, r]) => L.push(line(i, r)));
  }
  if (ins.summary) L.push("", "SUMMARY", ins.summary);
  return L.join("\n");
}

// Row mapping (fleet_inspections columns ↔ these names) lives in mapping.ts.
export { inspectionFromRow, inspectionToRow } from "./mapping";
