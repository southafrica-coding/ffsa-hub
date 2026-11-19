// Trips, workshop visits, clashes, similar free vehicles and free 48 hours (SPEC 6.6).
// Reference: tripsOf, tripOn, effStatus, wsEvents, freeOn, suggestGap, busy, alternatives,
// clashList in vehicles-module/app/ffsa-fleet.html. Ported line by line.

import { addDays, daysBetween, fmtDay, fmtRange, has, isoWeekday } from "./format";
import type { FleetData, FleetVehicle, ISODate, Sev, Trip, WorkshopVisit } from "./types";
import { B2B_KIND, NOT_IN_USE } from "./constants";

export const overlaps = (a1?: ISODate | null, a2?: ISODate | null, b1?: ISODate | null, b2?: ISODate | null): boolean =>
  !!(a1 && a2 && b1 && b2) && a1 <= b2 && b1 <= a2;
export const tripName = (t: Trip): string => t.label || "Trip";
export const kindShort = (k?: string | null): string => (k === B2B_KIND ? "Bumper-to-bumper inspection" : k || "Workshop visit");
export const inUse = (v: FleetVehicle): boolean => !NOT_IN_USE.includes(v.status || "");
export const seatClass = (v: FleetVehicle): "van" | "car" => ((Number(v.seats) || 0) >= 7 ? "van" : "car");
export const seatLabel = (v: FleetVehicle): string => (has(v.seats) ? `${v.seats} seats` : "");
export const vmapOf = (F: FleetData): Record<string, FleetVehicle> =>
  Object.fromEntries(F.vehicles.map((v) => [v.id, v]));

export function tripsOf(F: FleetData, vid: string): Trip[] {
  return F.trips.filter((t) => t.vehicleId === vid).sort((a, b) => (a.from || "").localeCompare(b.from || ""));
}
export function tripOn(F: FleetData, vid: string, date?: ISODate | null): Trip | null {
  return date
    ? F.trips.find((t) => t.vehicleId === vid && t.from && t.to && t.from <= date && date <= t.to) || null
    : null;
}
export const activeTrip = (F: FleetData, v: FleetVehicle) => tripOn(F, v.id, F.today);
export function nextTrip(F: FleetData, v: FleetVehicle): Trip | null {
  return tripsOf(F, v.id).find((x) => x.from > F.today) || null;
}
export function effStatus(F: FleetData, v: FleetVehicle): string {
  const s = v.status || "In service";
  return activeTrip(F, v) && !["Off the road", "For sale", "In workshop"].includes(s) ? "On a trip" : s;
}

export interface WsEvent {
  id: string;
  vehicleId: string;
  from: ISODate;
  to: ISODate;
  kind?: string | null;
  provider?: string | null;
  rec?: WorkshopVisit;
}

/** Booked workshop visits, plus each vehicle's follow-up that isn't one of them. */
export function wsEvents(F: FleetData): WsEvent[] {
  const out: WsEvent[] = [];
  const seen = new Set<string>();
  const vmap = vmapOf(F);
  for (const r of F.visits) {
    if (r.status !== "booked" || !r.date || !vmap[r.vehicleId]) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      vehicleId: r.vehicleId,
      from: r.date,
      to: r.until && r.until >= r.date ? r.until : r.date,
      kind: r.kind,
      provider: r.provider,
      rec: r,
    });
  }
  for (const v of F.vehicles) {
    const fu = v.followUp;
    if (fu && fu.date && !(fu.recId && seen.has(fu.recId)))
      out.push({
        id: fu.recId || "fu-" + v.id,
        vehicleId: v.id,
        from: fu.date,
        to: fu.until && fu.until >= fu.date ? fu.until : fu.date,
        kind: fu.kind,
        provider: fu.provider,
      });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

export function freeOn(F: FleetData, vid: string, date: ISODate, ignore?: string): boolean {
  return !tripOn(F, vid, date) && !wsEvents(F).some((w) => w.vehicleId === vid && w.id !== ignore && w.from <= date && date <= w.to);
}

/** First two weekdays in a row (Mon–Fri) with no trip, rental or workshop visit. */
export function suggestGap(F: FleetData, vid: string, opts: { from?: ISODate; ignore?: string } = {}) {
  let d = opts.from && opts.from > F.today ? opts.from : addDays(F.today, 1);
  for (let i = 0; i < 120; i++, d = addDays(d, 1)) {
    const d2 = addDays(d, 1);
    if (isoWeekday(d) > 5 || isoWeekday(d2) > 5) continue;
    if (freeOn(F, vid, d, opts.ignore) && freeOn(F, vid, d2, opts.ignore)) return { from: d, to: d2 };
  }
  return null;
}

export function busy(F: FleetData, vid: string, from: ISODate, to: ISODate, ignoreTrip?: string): boolean {
  return (
    tripsOf(F, vid).some((t) => t.id !== ignoreTrip && overlaps(from, to, t.from, t.to)) ||
    wsEvents(F).some((w) => w.vehicleId === vid && overlaps(from, to, w.from, w.to))
  );
}

/** Similar vehicles (car or van) that are free for the whole of a trip. */
export function alternatives(F: FleetData, trip: Trip): FleetVehicle[] {
  const v0 = vmapOf(F)[trip.vehicleId];
  if (!v0) return [];
  return F.vehicles.filter(
    (v) =>
      v.id !== v0.id &&
      inUse(v) &&
      seatClass(v) === seatClass(v0) &&
      !busy(F, v.id, trip.from, trip.to) &&
      !(v.status === "In workshop" && trip.from <= F.today)
  );
}

export interface Clash {
  sev: Sev;
  kind: "overlap" | "near" | "double" | "unusable";
  vehicleId: string;
  w?: WsEvent;
  t?: Trip;
  t0?: Trip;
  text: string;
}

export function clashList(F: FleetData): Clash[] {
  const today = F.today;
  const out: Clash[] = [];
  for (const w of wsEvents(F)) {
    if (w.to < today) continue;
    for (const t of tripsOf(F, w.vehicleId)) {
      if (!t.from || !t.to || t.to < today) continue;
      if (overlaps(w.from, w.to, t.from, t.to))
        out.push({
          sev: "crit",
          kind: "overlap",
          vehicleId: w.vehicleId,
          w,
          t,
          text: `${kindShort(w.kind)} (${fmtRange(w.from, w.to)}) clashes with ${tripName(t)} (${fmtRange(t.from, t.to)})`,
        });
      else {
        const gap = daysBetween(w.to, t.from);
        if (gap >= 1 && gap <= 7)
          out.push({
            sev: "warn",
            kind: "near",
            vehicleId: w.vehicleId,
            w,
            t,
            text: `${tripName(t)} starts ${fmtDay(t.from)}, ${gap === 1 ? "the day after" : gap + " days after"} the ${kindShort(w.kind).toLowerCase()} (${fmtRange(w.from, w.to)}): make sure it’s back and checked in time`,
          });
      }
    }
  }
  for (const v of F.vehicles) {
    const ts = tripsOf(F, v.id).filter((t) => t.from && t.to && t.to >= today);
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        if (overlaps(ts[i].from, ts[i].to, ts[j].from, ts[j].to))
          out.push({
            sev: "crit",
            kind: "double",
            vehicleId: v.id,
            t: ts[j],
            t0: ts[i],
            text: `Double booked: ${tripName(ts[i])} (${fmtRange(ts[i].from, ts[i].to)}) and ${tripName(ts[j])} (${fmtRange(ts[j].from, ts[j].to)})`,
          });
    if (!inUse(v))
      for (const t of ts)
        out.push({
          sev: "crit",
          kind: "unusable",
          vehicleId: v.id,
          t,
          text: `${tripName(t)} (${fmtRange(t.from, t.to)}) is booked on a vehicle that’s ${String(v.status).toLowerCase()}`,
        });
  }
  return out;
}

/** The note under a clash: which similar vehicles are free, or what to do if none is. */
export function clashNote(F: FleetData, c: Clash): string {
  const solve = c.t && c.kind !== "near";
  if (!solve || !c.t) return "";
  const v = vmapOf(F)[c.vehicleId];
  const alts = alternatives(F, c.t);
  const kind = v && seatClass(v) === "van" ? "van" : "car";
  return alts.length
    ? `Free ${kind}${alts.length > 1 ? "s" : ""} for those dates: ${alts.map((a) => a.name + (seatLabel(a) ? " (" + seatLabel(a) + ")" : "")).join(", ")}.`
    : `No similar ${kind} is free for those dates. Move the workshop visit, or tell the renter they can wait until it’s back or make other plans.`;
}
