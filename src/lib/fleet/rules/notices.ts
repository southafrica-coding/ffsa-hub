// SPEC 7.3: when a workshop visit is booked or moved, who has to hear about it. Nothing is
// sent by itself: the co-ordinator taps "Let them know" on a clash (Fleet part 5b, Gideon
// 19 Nov), and it goes through the Hub's booking notice.
// Every booking it overlaps gets a clash notice (with similar free vehicles, or "wait
// until it's back or make other plans"); every booking starting within 7 days after it
// gets a heads-up. Built on the same rules as the Calendar's clash list (6.6).

import { alternatives, kindShort, overlaps, seatClass, seatLabel, tripName, tripsOf, vmapOf, wsEvents, type WsEvent } from "./bookings";
import { addDays, daysBetween, fmtDay, fmtRange } from "./format";
import type { FleetData, FleetVehicle, ISODate, Trip } from "./types";

export interface VisitNotice {
  kind: "clash" | "heads-up";
  trip: Trip;
  /** The Hub booking id (trip ids are "<bookingId>:<vehicleId>"). */
  bookingId: string;
  vehicle: FleetVehicle;
  visit: WsEvent;
  /** Similar vehicles free for the whole booking (clashes only). */
  alternatives: FleetVehicle[];
  /** The day after the visit ends: when the vehicle is back. */
  backOn: ISODate;
  /** What the person who booked is told. */
  text: string;
}

const vname = (v: FleetVehicle) => (v.reg ? `${v.name} (${v.reg})` : v.name);

/** The notices for one booked visit, by its id, in date order. Past bookings are skipped. */
export function visitNotices(F: FleetData, visitId: string): VisitNotice[] {
  const w = wsEvents(F).find((e) => e.id === visitId);
  const v = w && vmapOf(F)[w.vehicleId];
  if (!w || !v || w.to < F.today) return [];
  const backOn = addDays(w.to, 1);
  const what = kindShort(w.kind).toLowerCase();
  const out: VisitNotice[] = [];
  for (const t of tripsOf(F, v.id)) {
    if (!t.from || !t.to || t.to < F.today) continue;
    const bookingId = t.id.split(":")[0];
    if (overlaps(w.from, w.to, t.from, t.to)) {
      const alts = alternatives(F, t);
      const kind = seatClass(v) === "van" ? "van" : "car";
      const offer = alts.length
        ? `Similar ${kind}${alts.length > 1 ? "s" : ""} free for your dates: ${alts.map((a) => a.name + (seatLabel(a) ? " (" + seatLabel(a) + ")" : "")).join(", ")}. The Vehicle Coordinator can switch you to one: reply to them.`
        : `No similar ${kind} is free for your dates. You can wait until it’s back on ${fmtDay(backOn)}, or make other plans.`;
      out.push({
        kind: "clash",
        trip: t,
        bookingId,
        vehicle: v,
        visit: w,
        alternatives: alts,
        backOn,
        text: `${vname(v)} is booked in for a ${what} ${fmtRange(w.from, w.to)}, during ${tripName(t)} (${fmtRange(t.from, t.to)}). ${offer}`,
      });
    } else {
      const gap = daysBetween(w.to, t.from);
      if (gap >= 1 && gap <= 7)
        out.push({
          kind: "heads-up",
          trip: t,
          bookingId,
          vehicle: v,
          visit: w,
          alternatives: [],
          backOn,
          text: `Heads-up: ${vname(v)} is booked in for a ${what} ${fmtRange(w.from, w.to)}, ${gap === 1 ? "the day before" : gap + " days before"} ${tripName(t)} starts (${fmtDay(t.from)}). It should be back in time; we’ll tell you if that changes.`,
        });
    }
  }
  return out.sort((a, b) => a.trip.from.localeCompare(b.trip.from));
}

/** True when a booked visit's dates or vehicle changed (or it's new), so notices are due. */
export function visitMoved(
  before: { vehicleId: string; date: ISODate; until?: ISODate | null; status: string } | null,
  after: { vehicleId: string; date: ISODate; until?: ISODate | null; status: string }
): boolean {
  if (after.status !== "booked") return false;
  if (!before || before.status !== "booked") return true;
  return before.vehicleId !== after.vehicleId || before.date !== after.date || (before.until || before.date) !== (after.until || after.date);
}

/** Vehicles a booked workshop visit blocks between two dates (SPEC 7.3), for the booking checks. */
export function visitBlockedIds(visits: { vehicleId: string; date: ISODate; until?: ISODate | null; status: string }[], from: ISODate, to: ISODate): string[] {
  return Array.from(
    new Set(visits.filter((r) => r.status === "booked" && r.date && overlaps(from, to, r.date, r.until && r.until >= r.date ? r.until : r.date)).map((r) => r.vehicleId))
  );
}
