// The Edit details form's logic (the Fleet app's saveVehicle), as a pure function.

import { has } from "@/lib/fleet/rules/format";
import type { FleetVehicle, KmAt } from "@/lib/fleet/rules/types";
import type { VehicleExtra } from "../vehicles/model";

/** Every editable field as the text in its input. The name isn't one: the Hub's vehicle
 *  list owns it (Settings), and Fleet never renames a vehicle. */
export interface VehicleForm {
  status: string;
  base: string;
  make: string;
  model: string;
  year: string;
  colour: string;
  transmission: string;
  vin: string;
  engineNo: string;
  odometer: string;
  licenceExpiry: string;
  lastServiceDate: string;
  lastServiceKm: string;
  lastB2BDate: string;
  lastB2BKm: string;
  serviceKm: string;
  serviceMonths: string;
  insurer: string;
  policyNo: string;
  tracker: string;
  tyres: string;
  where: string;
  notes: string;
}

const s = (v: unknown) => (has(v) ? String(v) : "");

export function vehicleFormOf(v: FleetVehicle, x: VehicleExtra): VehicleForm {
  const ls: KmAt = v.lastService || {};
  const lb: KmAt = v.lastB2B || {};
  return {
    status: s(v.status) || "In service",
    base: s(x.base),
    make: s(v.make),
    model: s(v.model),
    year: s(v.year),
    colour: s(v.colour),
    transmission: s(x.transmission),
    vin: s(x.vin),
    engineNo: s(x.engineNo),
    odometer: s(v.odometer),
    licenceExpiry: s(v.licenceExpiry),
    lastServiceDate: s(ls.date),
    lastServiceKm: s(ls.km),
    lastB2BDate: s(lb.date),
    lastB2BKm: s(lb.km),
    serviceKm: s(v.serviceKm),
    serviceMonths: s(v.serviceMonths),
    insurer: s(x.insurer),
    policyNo: s(x.policyNo),
    tracker: s(x.tracker),
    tyres: s(v.tyres),
    where: s(v.where),
    notes: s(x.notes),
  };
}

const toKm = (v: string): number | null => {
  const d = String(v || "").replace(/\D/g, "");
  return d ? Number(d) : null;
};
const txt = (v: string) => v.trim() || null;

/** The PATCH body's `patch` (app field names), and the odometer to log when it changed. */
export function vehiclePatch(
  initial: VehicleForm & { lastServiceProvider?: string; lastB2BProvider?: string },
  f: VehicleForm,
  today: string
): { error: string } | { patch: Record<string, unknown>; odometer: number | null } {
  const patch: Record<string, unknown> = {
    status: f.status,
    base: txt(f.base),
    make: txt(f.make),
    model: txt(f.model),
    year: toKm(f.year),
    colour: txt(f.colour),
    transmission: txt(f.transmission),
    vin: txt(f.vin),
    engineNo: txt(f.engineNo),
    licenceExpiry: f.licenceExpiry || null,
    lastService: { date: f.lastServiceDate || null, km: toKm(f.lastServiceKm), provider: initial.lastServiceProvider || "" },
    lastB2B: { date: f.lastB2BDate || null, km: toKm(f.lastB2BKm), provider: initial.lastB2BProvider || "" },
    serviceKm: toKm(f.serviceKm),
    serviceMonths: toKm(f.serviceMonths),
    insurer: txt(f.insurer),
    policyNo: txt(f.policyNo),
    tracker: txt(f.tracker),
    tyres: txt(f.tyres),
    where: txt(f.where),
    notes: txt(f.notes),
  };
  if (f.status !== initial.status) patch.statusSince = today;
  const km = toKm(f.odometer);
  return { patch, odometer: km !== null && km !== toKm(initial.odometer) ? km : null };
}
