// A vehicle's history report (Gideon, 23 Nov 2026: "download a report for a vehicle …
// showing everything that has been done to maintain the vehicle: things that have been
// fixed or worked on, services, repairs, inspections"). Pure: the route loads the data,
// this sorts it into a summary and a dated list, and report-pdf.tsx draws it.

import { wasLine } from "./fixes";
import { STATUS, checklistIndex, fmtDate, fmtKm, kindShort, typeOf, type Checklist, type ConditionEntry, type ISODate, type Trip, type WorkshopVisit } from "./rules";
import type { Inspection } from "./inspection";

export interface ReportFix {
  date: ISODate;
  point: string;
  by: string;
  work: string;
  was: { s?: string; d?: string; n?: string };
}
export interface ReportKm {
  date: ISODate;
  km: number;
  note?: string;
}
export type ReportVisit = WorkshopVisit & { odometer?: number | null; cost?: number | null; ref?: string; work?: { d?: string; cost?: number | null }[] | null };

export interface ReportInput {
  vehicle: { name: string; reg?: string | null; make?: string | null; model?: string | null; year?: string | number | null; colour?: string | null; vin?: string | null };
  from: ISODate;
  to: ISODate;
  inspections: Inspection[];
  visits: ReportVisit[];
  fixes: ReportFix[];
  readings: ReportKm[];
  trips: Trip[];
  /** The vehicle's condition now, for the issues still open. */
  condition: Record<string, ConditionEntry> | null | undefined;
  checklist: Checklist;
  today: ISODate;
}

export type EntryKind = "workshop" | "inspection" | "fixed" | "booking" | "km";
export interface ReportEntry {
  date: ISODate;
  kind: EntryKind;
  /** e.g. "Service · Motech", "Workshop report", "Fixed: Ball joints and control arms". */
  title: string;
  lines: string[];
  cost: number | null;
}

export interface VehicleReport {
  title: string;
  vehicleLine: string;
  period: string;
  generated: string;
  summary: { kmStart: number | null; kmEnd: number | null; kmDriven: number | null; spend: number; workshop: number; inspections: number; fixes: number; bookings: number };
  open: { point: string; state: string; note: string; since: string }[];
  entries: ReportEntry[];
}

export const KIND_LABEL: Record<EntryKind, string> = { workshop: "Workshop", inspection: "Inspection", fixed: "Fixed", booking: "Booking", km: "Km reading" };

export const fmtRand = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
const inRange = (d: string | null | undefined, from: ISODate, to: ISODate) => !!d && d >= from && d <= to;
const visitCost = (v: ReportVisit) => {
  if (v.cost != null && !isNaN(Number(v.cost))) return Number(v.cost);
  const lines = (v.work || []).map((w) => Number(w.cost)).filter((n) => !isNaN(n) && n > 0);
  return lines.length ? lines.reduce((a, b) => a + b, 0) : null;
};

export function buildVehicleReport(x: ReportInput): VehicleReport {
  const { from, to } = x;
  const entries: ReportEntry[] = [];

  // Workshop visits: done ones are work done; booked ones in the period are listed as booked.
  for (const v of x.visits) {
    if (!inRange(v.date, from, to)) continue;
    const cost = v.status === "done" ? visitCost(v) : null;
    const lines: string[] = [];
    if (v.status === "booked") lines.push(`Booked${v.until && v.until !== v.date ? ` until ${fmtDate(v.until)}` : ""}, not done yet`);
    if (v.description) lines.push(v.description);
    for (const w of v.work || []) if (w.d) lines.push(`• ${w.d}${w.cost ? ` (${fmtRand(Number(w.cost))})` : ""}`);
    const meta = [v.odometer ? fmtKm(v.odometer) : "", v.ref ? `Ref ${v.ref}` : ""].filter(Boolean).join(" · ");
    if (meta) lines.push(meta);
    entries.push({ date: v.date as ISODate, kind: "workshop", title: `${kindShort(v.kind)}${v.provider ? " · " + v.provider : ""}`, lines, cost });
  }

  // Inspections, with what they found.
  const ix = checklistIndex(x.checklist);
  for (const i of x.inspections) {
    if (!inRange(i.date, from, to)) continue;
    const c = i.counts || ({} as Inspection["counts"]);
    const lines = [
      [fmtKm(i.odometer), i.inspector ? `by ${i.inspector}` : "", i.provider || ""].filter(Boolean).join(" · "),
      `${c.fix || 0} fix now, ${c.mon || 0} monitor, ${c.ok || 0} OK${c.na ? `, ${c.na} N/A` : ""}`,
    ];
    for (const [id, r] of Object.entries(i.results || {}))
      if (r.s === "fix" || r.s === "mon") lines.push(`• ${STATUS[r.s]}: ${r.t || ix[id]?.t || id}${r.n ? ` (${r.n})` : ""}`);
    if (i.summary) lines.push(i.summary);
    entries.push({ date: i.date, kind: "inspection", title: typeOf(i.type).label, lines, cost: null });
  }

  for (const f of x.fixes) {
    if (!inRange(f.date, from, to)) continue;
    const lines = [`By ${f.by}: ${f.work}`];
    if (f.was.n) lines.push(wasLine(f.was, fmtDate));
    entries.push({ date: f.date, kind: "fixed", title: `Fixed: ${f.point}`, lines, cost: null });
  }

  for (const t of x.trips) {
    if (!(t.from <= to && t.to >= from)) continue;
    entries.push({ date: t.from < from ? from : t.from, kind: "booking", title: `Booking: ${t.label || "Trip"}`, lines: [[`${fmtDate(t.from)} – ${fmtDate(t.to)}`, t.who || ""].filter(Boolean).join(" · ")], cost: null });
  }

  for (const k of x.readings) {
    if (!inRange(k.date, from, to)) continue;
    entries.push({ date: k.date, kind: "km", title: fmtKm(k.km), lines: k.note ? [k.note] : [], cost: null });
  }

  const order: Record<EntryKind, number> = { workshop: 0, inspection: 1, fixed: 2, booking: 3, km: 4 };
  entries.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  // Km over the period: every reading, inspection and visit with a km in it.
  const kms = [
    ...x.readings.filter((k) => inRange(k.date, from, to)).map((k) => ({ d: k.date, km: Number(k.km) })),
    ...x.inspections.filter((i) => inRange(i.date, from, to)).map((i) => ({ d: i.date, km: Number(i.odometer) })),
    ...x.visits.filter((v) => v.status === "done" && inRange(v.date, from, to) && v.odometer).map((v) => ({ d: v.date as string, km: Number(v.odometer) })),
  ]
    .filter((p) => p.km > 0)
    .sort((a, b) => a.d.localeCompare(b.d) || a.km - b.km);
  const kmStart = kms.length ? kms[0].km : null;
  const kmEnd = kms.length ? kms[kms.length - 1].km : null;

  const open = Object.entries(x.condition || {})
    .filter(([, e]) => e && (e.s === "fix" || e.s === "mon"))
    .map(([id, e]) => ({ point: e.t || ix[id]?.t || id, state: STATUS[e.s!], note: e.n || "", since: e.d ? fmtDate(e.d) : "" }))
    .sort((a, b) => (a.state === STATUS.fix ? 0 : 1) - (b.state === STATUS.fix ? 0 : 1));

  const v = x.vehicle;
  return {
    title: `${v.name}${v.reg ? ` · ${v.reg}` : ""}`,
    vehicleLine: [[v.year, v.make, v.model].filter(Boolean).join(" "), v.colour, v.vin ? `VIN ${v.vin}` : ""].filter(Boolean).join(" · "),
    period: `${fmtDate(from)} – ${fmtDate(to)}`,
    generated: fmtDate(x.today),
    summary: {
      kmStart,
      kmEnd,
      kmDriven: kmStart != null && kmEnd != null ? kmEnd - kmStart : null,
      spend: entries.reduce((s, e) => s + (e.cost || 0), 0),
      workshop: entries.filter((e) => e.kind === "workshop").length,
      inspections: entries.filter((e) => e.kind === "inspection").length,
      fixes: entries.filter((e) => e.kind === "fixed").length,
      bookings: entries.filter((e) => e.kind === "booking").length,
    },
    open,
    entries,
  };
}

/** "ffsa-vehicle-report-KLK556NW-2026-12-01-to-2027-03-31.pdf" */
export const reportFileName = (reg: string | null | undefined, name: string, from: ISODate, to: ISODate) =>
  `ffsa-vehicle-report-${(reg || name).replace(/[^A-Za-z0-9]+/g, "")}-${from}-to-${to}.pdf`;
