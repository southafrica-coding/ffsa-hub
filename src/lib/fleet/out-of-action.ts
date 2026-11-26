// Fleet part 5c: a vehicle out of action on bookings (Gideon, 19 Nov 2026).
//
// A vehicle "In workshop" is in for a repair; "Off the road" has broken down. Either way the
// Hub marks it maintenance until Fleet marks it back (migration 357). Every Hub booking on it
// that's under way, or starts within the next 10 days, needs the co-ordinator:
//   • a free vehicle of the same class (van for a van, car for a car) for the rest of the
//     booking: Move (the team keeps it; switching back is by hand, only if really needed);
//   • none free: a repair puts the booking ON HOLD until the vehicle is back; a breakdown
//     CANCELS it ("Vehicle broke down"). The co-ordinator can pick either.
// Once the vehicle is back, a booking on hold is listed to resume. Every action tells the
// person who booked through the Hub's booking notice, and only when tapped.
// Pure functions of FleetData; the rules in src/lib/fleet/rules aren't changed.

import { addDays, alternatives, fmtRange, fmtShort, tripName, tripsOf, type FleetData, type FleetVehicle, type ISODate, type Trip } from "@/lib/fleet/rules";

/** How far ahead a vehicle out of action is checked for bookings. */
export const LOOK_AHEAD_DAYS = 10;

export type OutKind = "repair" | "breakdown";

export interface AffectedBooking {
  bookingId: string;
  tripId: string;
  label: string;
  who: string | null;
  from: ISODate;
  to: ISODate;
  /** Under way today (the team has the vehicle now). */
  inProgress: boolean;
  onHold: ISODate | null;
  /** Same class, free from today (or the start) to the end of the booking. */
  swaps: { id: string; name: string }[];
  /** The trip as Move sends it. */
  trip: { id: string; label: string; from: ISODate; to: ISODate };
}

export interface OutVehicle {
  id: string;
  name: string;
  kind: OutKind;
  since: ISODate | null;
  bookings: AffectedBooking[];
}

export interface ResumeItem {
  bookingId: string;
  label: string;
  who: string | null;
  vehicleName: string;
  from: ISODate;
  to: ISODate;
  onHold: ISODate;
}

export const outKindOf = (v: FleetVehicle): OutKind | null => (v.status === "In workshop" ? "repair" : v.status === "Off the road" ? "breakdown" : null);

/** The rest of a booking from today: what a swap has to be free for. */
export const restOf = (t: Trip, today: ISODate): Trip => (t.from < today ? { ...t, from: today } : t);

export function outOfAction(F: FleetData): { vehicles: OutVehicle[]; resume: ResumeItem[] } {
  const today = F.today;
  const horizon = addDays(today, LOOK_AHEAD_DAYS);
  const vehicles: OutVehicle[] = [];
  for (const v of F.vehicles) {
    const kind = outKindOf(v);
    if (!kind) continue;
    const bookings = tripsOf(F, v.id)
      .filter((t) => t.source === "hub" && t.to >= today && t.from <= horizon)
      .map((t) => ({
        bookingId: t.id.split(":")[0],
        tripId: t.id,
        label: tripName(t),
        who: t.who ?? null,
        from: t.from,
        to: t.to,
        inProgress: t.from <= today,
        onHold: t.onHold ?? null,
        swaps: alternatives(F, restOf(t, today)).map((a) => ({ id: a.id, name: a.name })),
        trip: { id: t.id, label: tripName(t), from: t.from, to: t.to },
      }));
    vehicles.push({ id: v.id, name: v.name, kind, since: v.statusSince ?? null, bookings });
  }
  const resume: ResumeItem[] = [];
  for (const v of F.vehicles) {
    if (outKindOf(v)) continue;
    for (const t of tripsOf(F, v.id))
      if (t.source === "hub" && t.onHold && t.to >= today)
        resume.push({ bookingId: t.id.split(":")[0], label: tripName(t), who: t.who ?? null, vehicleName: v.name, from: t.from, to: t.to, onHold: t.onHold });
  }
  return { vehicles, resume };
}

const vname = (v: { name: string }) => v.name;

/** What the person who booked is told (Fleet 5c). */
export const noticeText = {
  hold: (vehicle: string, kind: OutKind) =>
    `Your booking is on hold: ${vehicle} is ${kind === "repair" ? "in for a repair" : "off the road"}, and no similar vehicle is free for your dates. We’ll tell you as soon as it’s back.`,
  resume: (vehicle: string) => `${vehicle} is back, so your booking carries on as planned.`,
  cancel: (vehicle: string) => `Vehicle broke down: ${vehicle} is off the road and no similar vehicle is free for your dates, so this booking is cancelled. Please make other plans, or ask the Vehicle Coordinator about other dates.`,
};

export const outLine = (o: OutVehicle) =>
  `${vname(o)} is ${o.kind === "repair" ? "in for a repair" : "broken down (off the road)"}${o.since ? ` since ${fmtShort(o.since)}` : ""}. It can’t be booked until it’s marked back in service.`;

export const bookingLine = (b: AffectedBooking) =>
  `${b.label}${b.who ? " · " + b.who : ""} · ${fmtRange(b.from, b.to)}${b.inProgress ? " · under way" : ""}${b.onHold ? " · on hold" : ""}`;
