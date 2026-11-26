// Pure helpers for the vehicle page (the Fleet app's vehicleView and its tabs). Rules come
// from @/lib/fleet/rules unchanged; this file shapes them for the screen and holds the
// small page-level pieces the app keeps beside its views (issuesText, pointTag, byDateDesc…).

import checklistContent from "@/lib/fleet/content/checklist.json";
import { inspectionFromRow as mapInspectionRow } from "@/lib/fleet/mapping";
import {
  KM_RULES,
  STATUS,
  TYPES,
  addDays,
  attentionByItem,
  attentionFor,
  checklistIndex,
  checklistOrder,
  condCounts,
  daysUntil,
  fmtDate,
  fmtKm,
  has,
  inType,
  kmDueText,
  kmPlan,
  nextService,
  profileOf,
  serviceEvery,
  tripName,
  typeOf,
  type AttentionItem,
  type Checklist,
  type ChecklistItem,
  type ConditionEntry,
  type FleetData,
  type FleetVehicle,
  type ISODate,
  type Trip,
  type WorkshopVisit,
} from "@/lib/fleet/rules";
import { ago, fmtR, type VehicleExtra } from "../vehicles/model";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const TABS = [
  ["overview", "Overview"],
  ["condition", "Condition"],
  ["history", "History"],
  ["photos", "Photos"],
  ["manual", "Manual"],
] as const;
export type Tab = (typeof TABS)[number][0];
export const tabOf = (s?: string | string[] | null): Tab => {
  const t = Array.isArray(s) ? s[0] : s;
  return (TABS.find(([k]) => k === t)?.[0] ?? "overview") as Tab;
};

export type CondFilter = "all" | "issues" | "unchecked" | "ok";
export const condFilterOf = (s?: string | string[] | null): CondFilter => {
  const f = Array.isArray(s) ? s[0] : s;
  return f === "issues" || f === "unchecked" || f === "ok" ? f : "all";
};

export const WORK_CHECK: Record<string, string> = { ok: "Done properly", bad: "Not right", na: "Couldn’t check" };
export const WATCH_KIND: Record<string, string> = { damage: "Damage", repair: "Recent repair", issue: "Known problem" };
export const ATT_LABEL: Record<string, string> = { damage: "Damage", repair: "Recent repair", issue: "Known problem", fix: "Fix now", mon: "Monitor" };
export const ATT_TONE: Record<string, "warn" | "quiet" | "bad"> = { damage: "warn", repair: "quiet", issue: "warn", fix: "bad", mon: "warn" };
export const SLOTNAME: Record<string, string> = Object.fromEntries(checklistContent.walkAroundPhotos as [string, string][]);

/** Which check a point belongs to, for points never checked (the app's pointTag). */
export const pointTag = (it: { in?: string[] }): string => {
  const i = it.in || [];
  return i.includes("weekly")
    ? "Weekly"
    : i.includes("monthly")
      ? "Monthly"
      : i.includes("workshop")
        ? "Workshop"
        : i.length
          ? typeOf(i[0]).short
          : "Not in any check";
};

// ── Rows from the database ─────────────────────────────────

export interface Inspection {
  id: string;
  type: string;
  date: ISODate;
  odometer: number | null;
  inspector: string;
  provider: string;
  trip: string;
  counts: Record<string, number> | null;
  results: Record<string, { s?: string; p?: string[]; t?: string }>;
  walk: Record<string, string | null>;
  extra: string[];
  createdAt: string;
}

/** An inspection as the vehicle page shows it, from the shared row mapping plus the
 *  booking's name for a post-rental inspection. */
export function inspectionFromRow(r: Row, trips: Trip[] = []): Inspection {
  const i = mapInspectionRow(r);
  const trip = i.bookingId ? trips.find((t) => t.id.startsWith(i.bookingId + ":")) : null;
  return {
    id: i.id as string,
    type: i.type,
    date: i.date,
    odometer: r.odometer_km == null ? null : i.odometer,
    inspector: i.inspector,
    provider: i.provider,
    trip: trip ? tripName(trip) : "",
    counts: r.counts ? i.counts : null,
    results: i.results as Inspection["results"],
    walk: i.walk as Inspection["walk"],
    extra: i.extra,
    createdAt: i.createdAt as string,
  };
}

export interface KmReading {
  id: string;
  km: number;
  date: ISODate;
  note: string;
  createdAt: string;
}
export const kmFromRow = (r: Row): KmReading => ({ id: r.id, km: Number(r.km), date: r.date, note: r.note || "", createdAt: r.created_at || "" });

/** A point marked as fixed (fleet_fixes, 358): kept for good, whatever later inspections say. */
export interface Fix {
  id: string;
  date: ISODate;
  point: string;
  by: string;
  work: string;
  was: { s?: string; d?: string; n?: string };
  createdAt: string;
}
export const fixFromRow = (r: Row): Fix => ({
  id: r.id,
  date: r.fixed_on,
  point: r.point || "",
  by: r.fixed_by || "",
  work: r.work || "",
  was: (r.was && typeof r.was === "object" ? r.was : {}) as Fix["was"],
  createdAt: r.created_at || "",
});

/** A workshop visit as the page shows it (visitFromRow's output). */
export interface Visit {
  id: string;
  vehicleId: string;
  status: "booked" | "done";
  kind?: string | null;
  date?: ISODate | null;
  until?: ISODate | null;
  provider?: string | null;
  odometer?: number | null;
  cost?: number | null;
  ref?: string;
  description?: string;
  work?: { d?: string; cost?: number | null; chk?: string }[] | null;
  warrantyUntil?: string;
  checkedBy?: string;
  files?: { id: string; name?: string; type?: string }[];
  nextDate?: string;
  nextKm?: number | null;
  createdAt?: string;
}

const byDateDesc = (a: { date?: string | null; createdAt?: string }, b: { date?: string | null; createdAt?: string }) =>
  (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "");

// ── Overview ───────────────────────────────────────────────

/** Booked workshop visits, soonest first. */
export const bookedVisits = (visits: Visit[]) =>
  visits.filter((r) => r.status === "booked").sort((a, b) => (a.date || "").localeCompare(b.date || ""));

/** Workshop spend over the last 12 months (done visits with a cost). */
export function workshopSpend(visits: Visit[], today: ISODate): number {
  const yr = addDays(today, -365);
  return visits
    .filter((r) => r.status !== "booked" && (r.date || "") >= yr && has(r.cost))
    .reduce((s, r) => s + Number(r.cost), 0);
}

export interface KeyDate {
  k: string;
  /** null = "Not captured" */
  v: string | null;
  muted?: string;
  expired?: boolean;
}

/** The Key dates panel (overviewTab). */
export function keyDates(v: FleetVehicle, visits: Visit[], today: ISODate): KeyDate[] {
  const ns = nextService(v, today);
  const ls = v.lastService || {};
  const lb = v.lastB2B || {};
  const kp = kmPlan(v);
  const out: KeyDate[] = [];
  if (v.licenceExpiry) {
    const left = daysUntil(v.licenceExpiry, today);
    out.push({ k: "Licence disc expires", v: fmtDate(v.licenceExpiry), muted: left >= 0 ? `(${ago(v.licenceExpiry, today)})` : undefined, expired: left < 0 });
  } else out.push({ k: "Licence disc expires", v: null });
  out.push({
    k: "Last service",
    v: ls.date || has(ls.km) ? [ls.date ? fmtDate(ls.date) : "", has(ls.km) ? fmtKm(ls.km) : "", ls.provider || ""].filter(has).join(" · ") : null,
  });
  out.push({
    k: "Next service due",
    v: ns
      ? [has(ns.km) ? kmDueText(kp.service) : "", ns.date ? (has(ns.km) ? "or " : "") + fmtDate(ns.date) : ""].filter(has).join(" ")
      : null,
    muted: ns && kp.combined ? "(includes the bumper-to-bumper inspection)" : undefined,
  });
  out.push({
    k: "Service interval",
    v: [fmtKm(serviceEvery(v)) + (has(v.serviceKm) ? "" : " (FFSA rule)"), has(v.serviceMonths) ? v.serviceMonths + " months" : ""].filter(has).join(" or "),
  });
  out.push({
    k: "Last bumper-to-bumper",
    v: lb.date || has(lb.km) ? [lb.date ? fmtDate(lb.date) : "", has(lb.km) ? fmtKm(lb.km) : "", lb.provider || ""].filter(has).join(" · ") : null,
  });
  out.push({
    k: "Next bumper-to-bumper",
    v: kp.inspect ? kmDueText(kp.inspect) : null,
    muted: kp.inspect ? (kp.combined ? "(with the service) " : "") + "· every " + fmtKm(KM_RULES.inspect) : undefined,
  });
  out.push({ k: "Odometer recorded", v: v.odometerDate ? fmtDate(v.odometerDate) : null });
  const spend = workshopSpend(visits, today);
  out.push({ k: "Workshop spend, last 12 months", v: spend ? fmtR(spend) : "", muted: spend ? undefined : "None recorded yet" });
  return out;
}

/** Vehicle details (overviewTab). null = "Not captured". */
export function vehicleDetails(v: FleetVehicle, x: VehicleExtra): [string, string | null][] {
  const s = (val: unknown) => (has(val) ? String(val) : null);
  return [
    ["Registration", s(v.reg)],
    ["VIN", s(x.vin)],
    ["Engine number", s(x.engineNo)],
    ["Make and model", s([v.make, v.model].filter(has).join(" "))],
    ["Year", s(v.year)],
    ["Colour", s(v.colour)],
    ["Fuel", s(v.fuel)],
    ["Gearbox", s(x.transmission)],
    ["Seats", s(v.seats)],
    ["Insurer", s(x.insurer)],
    ["Policy number", s(x.policyNo)],
    ["Tracking company", s(x.tracker)],
    ["Based at / allocated to", s(x.base)],
  ];
}

/** The line under the header's make/model (vehicleView's vmeta). */
export const headerMeta = (v: FleetVehicle, x: VehicleExtra) =>
  [[v.year, v.make, v.model].filter(has).join(" "), v.colour, x.transmission, has(v.seats) ? v.seats + " seats" : ""].filter(has).join(" · ") ||
  "Make, model and year not captured yet";

/** Trips and rentals from 30 days ago on (tripsPanel). */
export function recentTrips(F: FleetData, vid: string): (Trip & { when: "now" | "past" | "soon" })[] {
  const since = addDays(F.today, -30);
  return F.trips
    .filter((t) => t.vehicleId === vid && (t.to || "") >= since)
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((t) => ({ ...t, when: t.from <= F.today && F.today <= t.to ? "now" : t.to < F.today ? "past" : "soon" }));
}

// ── Keep an eye on ─────────────────────────────────────────

export interface AttentionRow extends AttentionItem {
  label: string;
  line: string;
}

/** attentionFor, with the label and the small grey line the app shows under each. */
export function attentionRows(cl: Checklist, v: FleetVehicle, today: ISODate, visits: Visit[]): AttentionRow[] {
  const ix = checklistIndex(cl);
  return attentionFor(cl, v, today, visits as WorkshopVisit[]).map((a) => ({
    ...a,
    label: ATT_LABEL[a.k] || "Note",
    line: [
      a.d ? fmtDate(a.d) : "",
      a.items.length ? "Check at: " + a.items.map((i) => (ix[i] ? ix[i].t : "")).filter(has).join(", ") : "",
      a.src === "record" ? "from the workshop history" : a.src === "flag" ? "from the last inspection" : "",
    ]
      .filter(has)
      .join(" · "),
  }));
}

/** Points a watch note can be linked to: everything except workshop-only points (itemOptions). */
export function watchPointOptions(cl: Checklist) {
  return cl.sections
    .map((sec) => ({ name: sec.name, items: sec.items.filter((it) => !(it.in || []).every((x) => x === "workshop")).map((it) => ({ id: it.id, t: it.t })) }))
    .filter((s) => s.items.length);
}

// ── Issue list for workshop ────────────────────────────────

const unitOf = (it?: ChecklistItem): string => (it?.m as { u?: string } | undefined)?.u || "";

/** The text the app copies for the workshop (issuesText): Fix now, Monitor, and workshop
 *  points not checked in 6 months. */
export function issuesText(cl: Checklist, v: FleetVehicle, vin: string | null, today: ISODate): string {
  const ix = checklistIndex(cl);
  const order = checklistOrder(cl);
  const cond = v.condition || {};
  const L: string[] = [];
  L.push(`${v.name}${v.reg ? " (" + v.reg + ")" : ""}`);
  const desc = [[v.year, v.make, v.model].filter(has).join(" "), has(v.odometer) ? fmtKm(v.odometer) : "", vin ? "VIN " + vin : ""].filter(has).join(" · ");
  if (desc) L.push(desc);
  L.push(`Issue list as at ${fmtDate(today)}`);
  const line = (id: string, r: ConditionEntry) =>
    `- ${ix[id].t}${has(r.v) ? ": " + r.v + (unitOf(ix[id]) ? " " + unitOf(ix[id]) : "") : ""}${r.n ? ". " + r.n : ""} (noted ${fmtDate(r.d)})`;
  const fix = order.filter((id) => cond[id] && cond[id].s === "fix");
  const mon = order.filter((id) => cond[id] && cond[id].s === "mon");
  if (fix.length) {
    L.push("", "FIX NOW");
    fix.forEach((id) => L.push(line(id, cond[id])));
  }
  if (mon.length) {
    L.push("", "MONITOR");
    mon.forEach((id) => L.push(line(id, cond[id])));
  }
  if (!fix.length && !mon.length) L.push("", "No open issues from our own checks.");
  const stale = order.filter((id) => (ix[id].in || []).includes("workshop") && (!cond[id] || !cond[id].d || -daysUntil(cond[id].d as ISODate, today) > 182));
  if (stale.length) {
    L.push("", "PLEASE ALSO CHECK (not inspected in the last 6 months)");
    stale.forEach((id) => L.push("- " + ix[id].t));
  }
  return L.join("\n");
}

// ── Condition ──────────────────────────────────────────────

export interface CondRow {
  id: string;
  t: string;
  unit: string;
  tag: string;
  r: ConditionEntry | null;
}

/** The Condition tab: chips with counts, and the points per section for a filter. */
export function conditionView(cl: Checklist, v: FleetVehicle, f: CondFilter) {
  const cond = v.condition || {};
  const c = condCounts(cl, v);
  const chips: [CondFilter, string, number][] = [
    ["all", "All", c.total],
    ["issues", "Issues", c.fix + c.mon],
    ["unchecked", "Not checked yet", c.unchecked],
    ["ok", "OK", c.ok],
  ];
  const sections: { name: string; rows: CondRow[] }[] = [];
  for (const sec of cl.sections) {
    const items = sec.items.filter((it) => {
      const s = cond[it.id] && cond[it.id].s;
      if (f === "issues") return s === "fix" || s === "mon";
      if (f === "unchecked") return !s;
      if (f === "ok") return s === "ok";
      return true;
    });
    if (f === "issues") items.sort((a, b) => (cond[a.id].s === "fix" ? 0 : 1) - (cond[b.id].s === "fix" ? 0 : 1));
    if (!items.length) continue;
    sections.push({ name: sec.name, rows: items.map((it) => ({ id: it.id, t: it.t, unit: unitOf(it), tag: pointTag(it), r: cond[it.id] || null })) });
  }
  return { chips, sections, empty: f === "issues" ? "No open issues on the latest checks." : "Nothing in this view." };
}

// ── History ────────────────────────────────────────────────

export type HistoryItem = ({ k: "i" } & Inspection) | ({ k: "r" } & Visit) | ({ k: "o" } & KmReading) | ({ k: "f" } & Fix);

/** Inspections, workshop visits and km readings, newest first (historyTab). */
export function historyItems(insp: Inspection[], visits: Visit[], odo: KmReading[], fixes: Fix[] = []): HistoryItem[] {
  return [
    ...insp.map((x) => ({ k: "i" as const, ...x })),
    ...visits.map((x) => ({ k: "r" as const, ...x })),
    ...odo.map((x) => ({ k: "o" as const, ...x })),
    ...fixes.map((x) => ({ k: "f" as const, ...x })),
  ].sort(byDateDesc);
}

/** "· "-joined line under an inspection in History (histInsp). */
export const inspectionMeta = (x: Inspection) =>
  [has(x.odometer) ? fmtKm(x.odometer) : "", x.trip, x.inspector ? "by " + x.inspector : "", x.provider].filter(has).join(" · ");

// ── Photos ─────────────────────────────────────────────────

export interface PhotoGroup {
  date: ISODate;
  createdAt: string;
  title: string;
  inspectionId?: string;
  ph: { id: string; cap: string }[];
}

/** Walk-around, issue and extra photos per inspection, and workshop photos (photosTab). */
export function photoGroups(insp: Inspection[], visits: Visit[]): PhotoGroup[] {
  const groups: PhotoGroup[] = [];
  for (const ins of insp) {
    const ph: PhotoGroup["ph"] = [];
    for (const [slot, id] of Object.entries(ins.walk || {})) if (id) ph.push({ id, cap: SLOTNAME[slot] || slot });
    for (const r of Object.values(ins.results || {})) for (const id of r.p || []) ph.push({ id, cap: r.t || "" });
    for (const id of ins.extra || []) ph.push({ id, cap: "Extra photo" });
    if (ph.length) groups.push({ date: ins.date, createdAt: ins.createdAt, title: typeOf(ins.type).label, inspectionId: ins.id, ph });
  }
  for (const r of visits) {
    const ph = (r.files || []).filter((f) => (f.type || "").startsWith("image/")).map((f) => ({ id: f.id, cap: f.name || r.kind || "" }));
    if (ph.length) groups.push({ date: r.date || "", createdAt: r.createdAt || "", title: r.kind || "Workshop visit", ph });
  }
  return groups.sort(byDateDesc);
}

// ── Manual ─────────────────────────────────────────────────

interface ContentHelp {
  why?: string;
  safetyFirst?: string;
  howToCheck?: string[];
  markOk?: string;
  markMonitor?: string;
  markFixNow?: string;
  looksLike?: string;
  whatGoesWrong?: { problem: string; signs: string }[];
}
const HELP: Record<string, ContentHelp> = Object.fromEntries(
  (checklistContent.items as { id: string; help?: ContentHelp }[]).map((it) => [it.id, it.help || {}])
);
const ROUTE = checklistContent.route as { id: string; title: string; instructions: string; items: string[] }[];

export interface ManualPoint {
  id: string;
  t: string;
  tags: string[];
  watch: AttentionItem[];
  help: ContentHelp;
  vehicleNote: string;
}

/** Every check in walk-around order with its help (manualTab): points this model doesn't
 *  have are left out. */
export function manualStages(cl: Checklist, v: FleetVehicle, today: ISODate, visits: Visit[]) {
  const pr = profileOf(v);
  const na = new Set((pr && pr.na) || []);
  const ix = checklistIndex(cl);
  const attn = attentionByItem(cl, v, today, visits as WorkshopVisit[]);
  const types = ["pre", "post", "weekly", "monthly", "workshop"];
  const out: { id: string; t: string; i: string; points: ManualPoint[] }[] = [];
  for (const st of ROUTE) {
    const ids = st.items.filter((id) => ix[id] && !na.has(id) && types.some((t) => inType(ix[id], t)));
    if (st.id !== "ready" && !ids.length) continue;
    out.push({
      id: st.id,
      t: st.title,
      i: st.instructions,
      points: ids.map((id) => ({
        id,
        t: ix[id].t,
        tags: TYPES.filter((t) => (ix[id].in || []).includes(t.id)).map((t) => t.short),
        watch: attn[id] || [],
        help: HELP[id] || {},
        vehicleNote: (pr && pr.item && pr.item[id]) || "",
      })),
    });
  }
  return out;
}

/** How to mark a point (helpHTML's last block). */
export const markRows = (h: ContentHelp): [string, string, string][] =>
  (
    [
      ["ok", STATUS.ok, h.markOk],
      ["mon", STATUS.mon, h.markMonitor],
      ["fix", STATUS.fix, h.markFixNow],
    ] as [string, string, string | undefined][]
  ).filter((x): x is [string, string, string] => !!x[2]);

// ── Draft ──────────────────────────────────────────────────

export const draftKey = (vehicleId: string) => "ffsa-fleet-draft-" + vehicleId;

/** Points checked in a saved draft, or null when there's no usable draft. */
export function draftChecked(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return null;
    return Object.values((d.results || {}) as Record<string, { s?: string } | null>).filter((r) => r && r.s).length;
  } catch {
    return null;
  }
}
