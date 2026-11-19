// Services and bumper-to-bumper inspections by km (SPEC 6.4), odometer and km a day (6.5).
// Reference: serviceEvery, nextService, kmPlan, kmBooked, kmAlerts, kmDueText, dueKind,
// odoPatch, kmRate, projText in vehicles-module/app/ffsa-fleet.html. Ported line by line.

import { B2B_KIND, KM_RULES } from "./constants";
import { addDays, addMonths, daysBetween, daysUntil, fmtDay, fmtKm, has } from "./format";
import type { Alert, FleetData, FleetVehicle, ISODate } from "./types";

export const serviceEvery = (v: FleetVehicle): number =>
  has(v.serviceKm) && Number(v.serviceKm) > 0 ? Number(v.serviceKm) : KM_RULES.service;

export function nextService(v: FleetVehicle, today: ISODate) {
  const ls = v.lastService || {};
  const r: { km?: number; kmLeft?: number | null; date?: ISODate; daysLeft?: number } = {};
  let any = false;
  if (has(ls.km)) {
    r.km = Number(ls.km) + serviceEvery(v);
    r.kmLeft = has(v.odometer) ? r.km - Number(v.odometer) : null;
    any = true;
  }
  if (ls.date && has(v.serviceMonths)) {
    r.date = addMonths(ls.date, Number(v.serviceMonths));
    r.daysLeft = daysUntil(r.date, today);
    any = true;
  }
  return any ? r : null;
}

export interface Due {
  km: number;
  left: number | null;
}
export interface KmPlan {
  odo: number | null;
  every: number;
  service?: Due;
  inspect?: Due;
  combined: boolean;
}

/** Next bumper-to-bumper inspection and service by km. combined = the service falls due with
 *  (or before) the inspection, so one visit covers both. */
export function kmPlan(v: FleetVehicle): KmPlan {
  const odo = has(v.odometer) ? Number(v.odometer) : null;
  const ls = v.lastService || {},
    lb = v.lastB2B || {};
  const sKm = has(ls.km) ? Number(ls.km) : null,
    bKm = has(lb.km) ? Number(lb.km) : null;
  const p: KmPlan = { odo, every: serviceEvery(v), combined: false };
  if (sKm !== null) p.service = { km: sKm + p.every, left: odo !== null ? sKm + p.every - odo : null };
  const base = [sKm, bKm].filter((x): x is number => x !== null);
  if (base.length) {
    const b = Math.max(...base);
    p.inspect = { km: b + KM_RULES.inspect, left: odo !== null ? b + KM_RULES.inspect - odo : null };
  }
  const near = (d: Due) => has(d.left) && (d.left as number) <= KM_RULES.warn;
  p.combined = !!(
    p.service &&
    p.inspect &&
    (p.service.km <= p.inspect.km + KM_RULES.warn || (near(p.service) && near(p.inspect)))
  );
  return p;
}

/** A booked visit (or follow-up) of one of these kinds that hasn't ended yet. */
export function kmBooked(F: FleetData, v: FleetVehicle, kinds: string[]) {
  const t = F.today;
  const w = F.visits
    .filter(
      (r) =>
        r.status === "booked" &&
        r.vehicleId === v.id &&
        kinds.includes(r.kind || "") &&
        (r.until || r.date || "") >= t
    )
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  if (w) return { date: w.date as ISODate, kind: w.kind as string };
  const fu = v.followUp;
  return fu && fu.date && fu.date >= t && kinds.includes(fu.kind || "")
    ? { date: fu.date, kind: fu.kind as string }
    : null;
}

export function kmAlerts(F: FleetData, v: FleetVehicle): Alert[] {
  const p = kmPlan(v);
  const out: Alert[] = [];
  const one = (due: Due | undefined, label: string, kinds: string[], svc: boolean) => {
    if (!due || !has(due.left) || (due.left as number) > KM_RULES.warn) return;
    const left = due.left as number;
    const bk = kmBooked(F, v, kinds);
    if (bk)
      out.push({
        sev: "info",
        svc,
        booked: bk.date,
        text: `${label} ${left < 0 ? "overdue" : "due at " + fmtKm(due.km)}: booked for ${fmtDay(bk.date)}${svc && bk.kind !== "Service" ? " (ask for a service too)" : ""}`,
      });
    else if (left < 0)
      out.push({ sev: "crit", svc, text: `${label} overdue by ${fmtKm(-left)} (was due at ${fmtKm(due.km)})` });
    else
      out.push({ sev: "warn", svc, text: `${label} due in ${fmtKm(left)} (at ${fmtKm(due.km)}): book it at the workshop` });
  };
  if (p.combined) one(p.service, "Service and bumper-to-bumper inspection", ["Service", B2B_KIND], true);
  else {
    one(p.service, "Service", ["Service"], true);
    one(p.inspect, "Bumper-to-bumper inspection", [B2B_KIND, "Service"], false);
  }
  return out;
}

export const kmDueText = (due?: Due): string =>
  due
    ? `at ${fmtKm(due.km)}${has(due.left) ? ((due.left as number) < 0 ? `, overdue by ${fmtKm(-(due.left as number))}` : `, ${fmtKm(due.left)} to go`) : ""}`
    : "";

/** What to book when a km alert is due: a service if it's combined or the service is near. */
export const dueKind = (p?: KmPlan): string =>
  p && (p.combined || (p.service && has(p.service.left) && (p.service.left as number) <= KM_RULES.warn))
    ? "Service"
    : B2B_KIND;

/** Patch for a new odometer reading. Keeps the previous reading (at least a week older) to
 *  work out km a day. Returns {} when the reading is lower than the last one. */
export function odoPatch(v: FleetVehicle, km: number | null | undefined, date: ISODate) {
  if (km === null || km === undefined || (has(v.odometer) && km < Number(v.odometer))) return {};
  const p: Partial<FleetVehicle> = { odometer: km, odometerDate: date };
  if (has(v.odometer) && v.odometerDate && daysBetween(v.odometerDate, date) >= 7)
    p.odoPrev = { km: Number(v.odometer), date: v.odometerDate };
  return p;
}

export function kmRate(v: FleetVehicle): number | null {
  const p = v.odoPrev;
  if (!p || !has(p.km) || !p.date || !has(v.odometer) || !v.odometerDate) return null;
  const days = daysBetween(p.date, v.odometerDate);
  const km = Number(v.odometer) - Number(p.km);
  return days >= 3 && km > 0 ? km / days : null;
}

export function projText(v: FleetVehicle, due: Due | undefined, today: ISODate): string {
  const r = kmRate(v);
  if (!r || !due || !has(due.left) || (due.left as number) <= 0) return "";
  const when = addDays(v.odometerDate as ISODate, Math.floor((due.left as number) / r));
  return when < today
    ? `At about ${Math.round(r)} km a day it may already be past ${fmtKm(due.km)}: log a km reading.`
    : `At about ${Math.round(r)} km a day it gets there around ${fmtDay(when)}.`;
}
