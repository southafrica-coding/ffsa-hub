// Database rows ↔ the FFSA Fleet field names the rules read (SPEC section 4).
// One place for every column name, so a rule never reads a snake_case column and
// nothing is renamed without a mapping (vehicles-module/CLAUDE.md, "Don'ts").

import type {
  Checklist,
  FleetData,
  FleetVehicle,
  ISODate,
  Notify,
  Schedule,
  TimeLogEntry,
  Trip,
  WorkshopVisit,
} from "./rules/types";
import { asType, type Inspection } from "./inspection";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

// ── Vehicles ───────────────────────────────────────────────

/** vehicles row with `details` = its fleet_vehicle_details row (FLEET_VEHICLE_SELECT). */
export function vehicleFromRow(row: Row): FleetVehicle {
  const d: Row = (Array.isArray(row.details) ? row.details[0] : row.details) || {};
  return {
    id: row.id,
    name: row.name, // the Hub's name wins (Jack, 18 Nov 2026): Fleet never renames a vehicle
    reg: row.registration_plate ?? null,
    make: d.make ?? null,
    model: d.model ?? row.make_model ?? null,
    profile: d.profile ?? null,
    year: d.year ?? null,
    colour: d.colour ?? null,
    fuel: row.fuel_type ? row.fuel_type[0].toUpperCase() + row.fuel_type.slice(1) : null,
    seats: num(row.seats),
    status: d.fleet_status ?? "In service",
    statusSince: d.status_since ?? null,
    licenceExpiry: d.licence_expiry ?? null,
    odometer: num(d.odometer_km),
    odometerDate: d.odometer_date ?? null,
    odoPrev: d.odo_prev ?? null,
    lastService: d.last_service ?? null,
    lastB2B: d.last_b2b ?? null,
    serviceKm: num(d.service_km),
    serviceMonths: num(d.service_months),
    tyres: d.tyres ?? null,
    where: d.where_text ?? null,
    watch: d.watch ?? [],
    condition: d.condition ?? {},
    lastInspection: d.last_inspection ?? null,
    lastCheck: d.last_check ?? null,
    lastMonthly: d.last_monthly ?? null,
    lastPost: d.last_post ?? null,
    cardPrinted: d.card_printed ?? null,
    followUp: d.follow_up ?? null,
  };
}

const VEHICLE_COLUMNS: Record<string, string> = {
  make: "make",
  model: "model",
  profile: "profile",
  year: "year",
  colour: "colour",
  transmission: "transmission",
  vin: "vin",
  engineNo: "engine_no",
  insurer: "insurer",
  policyNo: "policy_no",
  tracker: "tracker",
  base: "base",
  photo: "photo_file_id",
  status: "fleet_status",
  statusSince: "status_since",
  licenceExpiry: "licence_expiry",
  odometer: "odometer_km",
  odometerDate: "odometer_date",
  odoPrev: "odo_prev",
  lastService: "last_service",
  lastB2B: "last_b2b",
  serviceKm: "service_km",
  serviceMonths: "service_months",
  inspectionDay: "inspection_day",
  tyres: "tyres",
  where: "where_text",
  watch: "watch",
  condition: "condition",
  lastInspection: "last_inspection",
  lastCheck: "last_check",
  lastMonthly: "last_monthly",
  lastPost: "last_post",
  cardPrinted: "card_printed",
  followUp: "follow_up",
  notes: "notes",
  sort: "sort_order",
};

/** A patch in the app's field names → fleet_vehicle_details columns. Unknown fields throw,
 *  so a typo can't silently drop data. */
export function vehiclePatchToColumns(patch: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "updatedAt" || k === "id") continue;
    const col = VEHICLE_COLUMNS[k];
    if (!col) throw new Error(`Unknown vehicle field: ${k}`);
    out[col] = v === undefined ? null : v;
  }
  return out;
}

// ── Trips ──────────────────────────────────────────────────

/** Approved/completed vehicle bookings → one trip per assigned vehicle. */
export function tripsFromBookings(rows: Row[]): Trip[] {
  const out: Trip[] = [];
  for (const b of rows) {
    if (!b.checkout_date || !b.return_date) continue;
    for (const a of b.assignments || []) {
      out.push({ id: `${b.id}:${a.vehicle_id}`, vehicleId: a.vehicle_id, from: b.checkout_date, to: b.return_date, label: b.booking_name || null, source: "hub" });
    }
  }
  return out;
}

// ── Workshop visits ────────────────────────────────────────

export function visitFromRow(r: Row): WorkshopVisit & Row {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    status: r.status,
    kind: r.kind,
    date: r.date,
    until: r.until ?? null,
    provider: r.provider ?? null,
    odometer: num(r.odometer_km),
    cost: num(r.cost),
    ref: r.ref ?? "",
    description: r.description ?? "",
    work: r.work ?? [],
    warrantyUntil: r.warranty_until ?? "",
    checkedBy: r.checked_by ?? "",
    files: r.files ?? [],
    nextDate: r.next_date ?? "",
    nextKm: num(r.next_km),
  };
}

// ── Settings ───────────────────────────────────────────────

export function settingsFromRow(
  row: Row | null | undefined,
  vehicles: { id: string; inspectionDay?: number | null }[]
): { schedule: Schedule | null; checklist: Checklist | null; notify: Notify } {
  const assign: Record<string, number> = {};
  for (const v of vehicles) if (v.inspectionDay) assign[v.id] = v.inspectionDay;
  if (!row) return { schedule: null, checklist: null, notify: {} };
  return {
    schedule: {
      days: row.days ?? [],
      maxPerDay: row.max_per_day ?? 2,
      assign,
      weeklyOnly: (row.weekly_only ?? []) as ISODate[],
      budgetHours: num(row.budget_hours) ?? 5,
    },
    // As the app: an empty saved checklist falls back to the standard list.
    checklist: row.checklist && Array.isArray(row.checklist.sections) && row.checklist.sections.length ? row.checklist : null,
    notify: row.notify ?? {},
  };
}

export function timeLogFromRow(r: Row): TimeLogEntry {
  return { date: r.date, week: r.week, kind: r.kind, type: r.type ?? undefined, vehicleId: r.vehicle_id ?? undefined, mins: Number(r.mins) };
}

// ── Inspections ────────────────────────────────────────────
// fleet_inspections columns ↔ the app's names (src/lib/fleet/inspection.ts).

export function inspectionToRow(doc: Inspection, userId: string | null) {
  return {
    vehicle_id: doc.vehicleId,
    type: doc.type,
    date: doc.date,
    odometer_km: doc.odometer,
    fuel: doc.fuel || null,
    inspector: doc.inspector || null,
    provider: doc.provider || null,
    booking_id: doc.bookingId,
    docs: doc.docs,
    results: doc.results,
    walk: doc.walk,
    extra: doc.extra,
    summary: doc.summary || null,
    counts: doc.counts,
    mins: doc.mins,
    started_at: doc.startedAt || null,
    created_by: userId,
  };
}

export function inspectionFromRow(r: Record<string, any>): Inspection {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    type: asType(r.type),
    date: r.date,
    odometer: Number(r.odometer_km),
    fuel: r.fuel ?? "",
    inspector: r.inspector ?? "",
    provider: r.provider ?? "",
    bookingId: r.booking_id ?? null,
    docs: r.docs ?? [],
    results: r.results ?? {},
    walk: r.walk ?? {},
    extra: r.extra ?? [],
    summary: r.summary ?? "",
    counts: { ok: 0, mon: 0, fix: 0, na: 0, ...(r.counts ?? {}) },
    mins: r.mins === null || r.mins === undefined ? null : Number(r.mins),
    startedAt: r.started_at ?? "",
    createdAt: r.created_at ?? "",
    createdBy: r.created_by ?? null,
  };
}

// ── Everything the rules need ──────────────────────────────

export function fleetDataFromRows(input: {
  today: ISODate;
  vehicles: Row[];
  bookings: Row[];
  visits: Row[];
  settings: Row | null;
  providers?: Row[];
  timelog?: Row[];
  coordinator?: { name?: string | null; phone?: string | null } | null;
  fallbackChecklist: Checklist;
}): FleetData {
  const vehicles = input.vehicles.map((row) => {
    const v = vehicleFromRow(row);
    const d: Row = (Array.isArray(row.details) ? row.details[0] : row.details) || {};
    return Object.assign(v, { inspectionDay: d.inspection_day ?? null, sort: Number(d.sort_order ?? row.sort_order ?? 0) });
  });
  // Fleet's own order (the app's `sort`), not the booking calendar's: lists and the
  // reminder show vehicles in this order.
  vehicles.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const s = settingsFromRow(input.settings, vehicles);
  return {
    today: input.today,
    vehicles,
    trips: tripsFromBookings(input.bookings),
    visits: input.visits.map(visitFromRow),
    checklist: s.checklist || input.fallbackChecklist,
    schedule: s.schedule,
    notify: { ...s.notify, coordName: input.coordinator?.name || "", coordPhone: input.coordinator?.phone || "" },
    providers: (input.providers || []).map((p) => ({ name: p.name })),
    timelog: (input.timelog || []).map(timeLogFromRow),
  };
}
