// Pure helpers for the Vehicles list (the Fleet app's fleetView and vehicleCard) and the
// small display pieces the vehicle page shares with it. Every rule comes from
// @/lib/fleet/rules; this file only shapes their output for the screens.

import {
  SEV_RANK,
  activeTrip,
  condCounts,
  daysUntil,
  effStatus,
  fmtDay,
  has,
  plural,
  vehicleAlerts,
  weekly,
  worst,
  type Alert,
  type Checklist,
  type FleetData,
  type FleetVehicle,
  type ISODate,
  type Weekly,
} from "@/lib/fleet/rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ── Formatting the app has and the rules don't ─────────────

/** "today", "yesterday", "12 days ago", "3 months ago", "in 4 days" (the app's ago()). */
export function ago(s: ISODate | null | undefined, today: ISODate): string {
  if (!s) return "";
  const d = -daysUntil(s, today);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 0) return "in " + plural(-d, "day");
  if (d < 45) return d + " days ago";
  const m = Math.round(d / 30.4);
  if (m < 18) return plural(m, "month") + " ago";
  return plural(Math.round(d / 365), "year") + " ago";
}

/** "R 1 234,50" (the app's fmtR), or "—". */
export const fmtR = (n: unknown): string =>
  has(n) && !isNaN(Number(n)) ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(n)) : "—";

/** The app's toKm: digits only, or null. */
export function toKm(v: unknown): number | null {
  if (!has(v)) return null;
  const s = String(v).replace(/\D/g, "");
  return s ? Number(s) : null;
}

export const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ── Vehicle details the rules don't carry ──────────────────

export interface VehicleExtra {
  photo: string | null;
  transmission: string | null;
  vin: string | null;
  engineNo: string | null;
  insurer: string | null;
  policyNo: string | null;
  tracker: string | null;
  base: string | null;
  notes: string | null;
  inspectionDay: number | null;
  lastInspection: { id?: string; date?: ISODate; type?: string; counts?: Record<string, number> } | null;
}

/** The fleet_vehicle_details fields a vehicle row carries beyond FleetVehicle, in app names. */
export function extraOf(row: Row | undefined | null): VehicleExtra {
  const d: Row = (row && (Array.isArray(row.details) ? row.details[0] : row.details)) || {};
  return {
    photo: d.photo_file_id || null,
    transmission: d.transmission || null,
    vin: d.vin || null,
    engineNo: d.engine_no || null,
    insurer: d.insurer || null,
    policyNo: d.policy_no || null,
    tracker: d.tracker || null,
    base: d.base || null,
    notes: d.notes || null,
    inspectionDay: d.inspection_day ?? null,
    lastInspection: d.last_inspection || null,
  };
}

// ── Status ─────────────────────────────────────────────────

export type Tone = "good" | "warn" | "quiet" | "bad";
// The app's VSTATUS_CLS (good / info / warn / crit / na) onto the Hub's pill tones.
const STATUS_TONE: Record<string, Tone> = {
  "In service": "good",
  "On a trip": "quiet",
  "Booked for workshop": "warn",
  "In workshop": "warn",
  "Off the road": "bad",
  "For sale": "quiet",
};

/** The app's statusPill: the effective status, "Away until …" while on a trip. */
export function statusOf(F: FleetData, v: FleetVehicle): { text: string; tone: Tone } {
  const s = effStatus(F, v);
  const t = activeTrip(F, v);
  return { text: s === "On a trip" && t ? "Away until " + fmtDay(t.to) : s, tone: STATUS_TONE[s] || "quiet" };
}

/** "Weekly check: due today" / "Monthly check: planned for Wed, 18 Nov" (vehicleCard). */
export function weekLine(w: Weekly): string {
  return `${w.st === "done" || w.st === "skip" || w.st === "none" ? "Weekly check" : w.name}: ${w.label}`;
}

// ── Condition bar ──────────────────────────────────────────

export interface CondBar {
  segs: { k: "fix" | "mon" | "ok" | "na"; pct: number }[];
  legend: string;
}

/** The app's condBar: segments fix · monitor · OK · N/A, and the legend line. */
export function condBar(cl: Checklist, v: FleetVehicle): CondBar {
  const c = condCounts(cl, v);
  const t = c.total || 1;
  const segs = (["fix", "mon", "ok", "na"] as const).filter((k) => c[k]).map((k) => ({ k, pct: Number(((c[k] / t) * 100).toFixed(2)) }));
  const parts: string[] = [];
  if (c.ok) parts.push(`${c.ok} OK`);
  if (c.mon) parts.push(`${c.mon} monitor`);
  if (c.fix) parts.push(`${c.fix} fix now`);
  parts.push(`${c.unchecked} of ${c.total} not checked yet`);
  return { segs, legend: parts.join(" · ") };
}

// ── Needs attention ────────────────────────────────────────

export type FleetAlert = Alert & { vehicleId: string; vehicleName: string };

/** Every non-info alert across the fleet, worst first (fleetView). */
export function fleetAttention(F: FleetData): FleetAlert[] {
  return F.vehicles
    .flatMap((v) =>
      vehicleAlerts(F, v)
        .filter((a) => a.sev !== "info")
        .map((a) => ({ ...a, vehicleId: v.id, vehicleName: v.name }))
    )
    .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
}

// ── Vehicle cards ──────────────────────────────────────────

export interface VehicleCard {
  id: string;
  name: string;
  reg: string | null;
  photo: string | null;
  mono: string;
  meta: string;
  odometer: number | null;
  sev: "crit" | "warn" | "ok";
  cond: CondBar;
  status: { text: string; tone: Tone };
  week: string;
  last: string;
  top: Alert | null;
}

export function vehicleCard(F: FleetData, v: FleetVehicle, row?: Row | null): VehicleCard {
  const al = vehicleAlerts(F, v);
  const top = al.filter((a) => a.sev !== "info").sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev])[0] || null;
  const x = extraOf(row);
  const li = x.lastInspection;
  return {
    id: v.id,
    name: v.name,
    reg: v.reg || null,
    photo: x.photo,
    mono: v.model || v.name || "?",
    meta: [v.year, v.make, v.model].filter(has).join(" ") || "Details not captured",
    odometer: has(v.odometer) ? Number(v.odometer) : null,
    sev: worst(al),
    cond: condBar(F.checklist, v),
    status: statusOf(F, v),
    week: weekLine(weekly(F, v)),
    last: li && li.date ? "Last inspection " + ago(li.date, F.today) : "Never inspected",
    top,
  };
}

export function vehicleCards(F: FleetData, rows: Row[]): VehicleCard[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return F.vehicles.map((v) => vehicleCard(F, v, byId.get(v.id)));
}
