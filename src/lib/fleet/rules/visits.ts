// Saving a workshop visit (SPEC 6.7): what's refused, and how the vehicle changes.
// Reference: saveRecord in vehicles-module/app/ffsa-fleet.html. The form reading and the
// "clashes with … Book it anyway?" confirm stay in the page; this is the rule part.

import { overlaps, tripName, tripsOf } from "./bookings";
import { B2B_KIND } from "./constants";
import { fmtRange, has } from "./format";
import { odoPatch } from "./km";
import type { FleetData, FleetVehicle, ISODate, Trip, WorkshopVisit } from "./types";

export interface VisitInput {
  id: string;
  status: "booked" | "done";
  kind: string;
  date: ISODate | "";
  until?: ISODate | "";
  provider?: string;
  odometer?: number | null;
  nextDate?: ISODate | "";
  nextKm?: number | null;
  /** "Also update the last service" (the Service form's checkbox). */
  updateLastService?: boolean;
  /** New licence disc expiry, for a Licence renewal. */
  disc?: ISODate | "";
}

/** The error message the app shows, or null when the visit can be saved. */
export function visitError(r: VisitInput): string | null {
  if (!r.date) return r.status === "booked" ? "Enter the day the vehicle goes in." : "Enter the date of the visit.";
  if (r.status === "done" && (r.kind === "Service" || r.kind === B2B_KIND) && (r.odometer === null || r.odometer === undefined))
    return "Enter the odometer reading: the next service and bumper-to-bumper inspection are worked out from it.";
  return null;
}

/** A booked visit runs to `until`, or the same day when `until` is empty or earlier. */
export const visitUntil = (r: VisitInput): ISODate | "" =>
  r.status === "booked" ? (!r.until || r.until < (r.date as ISODate) ? r.date : r.until) : "";

/** Trips a booked visit clashes with (the page asks "Book it anyway?"). */
export function visitClashes(F: FleetData, vehicleId: string, r: VisitInput): Trip[] {
  if (r.status !== "booked" || !r.date) return [];
  const until = visitUntil(r) as ISODate;
  return tripsOf(F, vehicleId).filter((t) => overlaps(r.date as ISODate, until, t.from, t.to));
}
export const visitClashText = (hits: Trip[]) =>
  `This visit clashes with ${hits.map((t) => tripName(t) + " (" + fmtRange(t.from, t.to) + ")").join(", ")}. Book it anyway? You can sort it out on the Calendar page.`;

/** The change to the vehicle when a visit is saved. `previous` is the visit before this save, if any. */
export function visitVehiclePatch(
  v: FleetVehicle,
  r: VisitInput,
  today: ISODate,
  previous?: Pick<WorkshopVisit, "status"> | null
): Partial<FleetVehicle> {
  const patch: Partial<FleetVehicle> = {};
  const date = r.date as ISODate;
  const provider = r.provider || "";
  if (r.status === "booked") {
    const until = visitUntil(r) as ISODate;
    patch.followUp = { date, until, km: null, kind: r.kind, provider, recId: r.id };
    if (!v.status || v.status === "In service") {
      patch.status = "Booked for workshop";
      patch.statusSince = today;
    }
  } else {
    const odo = r.odometer ?? null;
    if (odo !== null && (!has(v.odometer) || odo > Number(v.odometer))) Object.assign(patch, odoPatch(v, odo, date));
    if (r.kind === "Service" && r.updateLastService && (!v.lastService || !v.lastService.date || v.lastService.date <= date))
      patch.lastService = { date, km: odo, provider };
    if (r.kind === B2B_KIND && odo !== null && (!v.lastB2B || !v.lastB2B.date || v.lastB2B.date <= date))
      patch.lastB2B = { date, km: odo, provider };
    if (r.kind === "Licence renewal" && r.disc) patch.licenceExpiry = r.disc;
    if (v.followUp && v.followUp.recId === r.id) patch.followUp = null;
    if (r.nextDate || has(r.nextKm)) patch.followUp = { date: r.nextDate || null, km: r.nextKm ?? null, kind: r.kind, provider, recId: r.id };
    if (previous && previous.status === "booked" && (v.status === "Booked for workshop" || v.status === "In workshop")) {
      patch.status = "In service";
      patch.statusSince = date;
    }
  }
  return patch;
}
