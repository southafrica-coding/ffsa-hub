// The workshop-visit form's logic (the Fleet app's recordModal, updateBookingHint and
// saveRecord), kept out of the component so it can be tested.

import { overlaps, tripName } from "@/lib/fleet/rules/bookings";
import { B2B_KIND, RECORD_KINDS } from "@/lib/fleet/rules/constants";
import { daysBetween, fmtDay, fmtRange } from "@/lib/fleet/rules/format";
import { visitError } from "@/lib/fleet/rules/visits";
import type { ISODate, Trip } from "@/lib/fleet/rules/types";

export interface HintTrip {
  id: string;
  from: ISODate;
  to: ISODate;
  label?: string | null;
}

export interface BookingHint {
  clash: string | null;
  near: string | null;
  gap: { from: ISODate; to: ISODate; text: string } | null;
}

/** As the dates change: clashes with trips, a heads-up for trips starting within 7 days
 *  after, and the first free 48 hours (worked out on the server, ignoring this visit). */
export function bookingHint(trips: HintTrip[], from: ISODate | "", until: ISODate | "", gap: { from: ISODate; to: ISODate } | null): BookingHint {
  let to = until || from;
  if (!to || to < from) to = from;
  const hits = from ? trips.filter((t) => overlaps(from, to, t.from, t.to)) : [];
  const near = from ? trips.filter((t) => !overlaps(from, to, t.from, t.to) && t.from > to && daysBetween(to, t.from) <= 7) : [];
  return {
    clash: hits.length ? `Clashes with ${hits.map((t) => tripName(t as Trip) + " (" + fmtRange(t.from, t.to) + ")").join(", ")}.` : null,
    near: near.length ? `Heads-up: ${near.map((t) => tripName(t as Trip) + " starts " + fmtDay(t.from)).join(", ")}, soon after this visit.` : null,
    gap: gap ? { ...gap, text: fmtRange(gap.from, gap.to) } : null,
  };
}

export interface WorkLine {
  d: string;
  cost: string;
  chk: string;
}

export interface VisitFormState {
  status: "booked" | "done";
  kind: string;
  date: string;
  until: string;
  provider: string;
  providerOther: string;
  odometer: string;
  cost: string;
  ref: string;
  description: string;
  disc: string;
  updateLastService: boolean;
  work: WorkLine[];
  warrantyUntil: string;
  checkedBy: string;
  nextDate: string;
  nextKm: string;
  files: { id: string; name?: string; type?: string }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The form's starting values: a new booking, a new done visit, or an existing visit
 *  (with `status` forced to "done" for Record the outcome). */
export function initialVisitForm(
  status: "booked" | "done",
  today: ISODate,
  providers: string[],
  rec?: Record<string, any> | null
): VisitFormState {
  const r: Record<string, any> = rec || { kind: status === "booked" ? RECORD_KINDS[0] : "Service", date: today };
  const other = !!r.provider && !providers.includes(r.provider);
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const work: WorkLine[] = Array.isArray(r.work) && r.work.length ? r.work.map((w: any) => ({ d: s(w.d), cost: s(w.cost), chk: s(w.chk) })) : [{ d: "", cost: "", chk: "" }];
  return {
    status,
    kind: r.kind || (status === "booked" ? RECORD_KINDS[0] : "Service"),
    date: s(r.date),
    until: s(r.until || r.date),
    provider: other ? "__other" : s(r.provider),
    providerOther: other ? r.provider : "",
    odometer: s(r.odometer),
    cost: s(r.cost),
    ref: s(r.ref),
    description: s(r.description),
    disc: "",
    // Ticked for a new visit and for recording a booked one; off when editing a done visit.
    updateLastService: !(rec && rec.status !== "booked"),
    work,
    warrantyUntil: s(r.warrantyUntil),
    checkedBy: s(r.checkedBy),
    nextDate: s(r.nextDate),
    nextKm: s(r.nextKm),
    files: Array.isArray(r.files) ? r.files : [],
  };
}

const toKm = (v: string): number | null => {
  const d = String(v || "").replace(/\D/g, "");
  return d ? Number(d) : null;
};

/** The body for POST/PUT /api/vehicles/fleet/visits, or the app's error message. */
export function visitBody(
  vehicleId: string,
  f: VisitFormState,
  mins: number,
  rec?: Record<string, any> | null
): { error: string } | { body: Record<string, unknown> } {
  const provider = f.provider === "__other" ? f.providerOther.trim() : f.provider;
  const done = f.status === "done";
  const odometer = done ? toKm(f.odometer) : null;
  const err = visitError({ id: "", status: f.status, kind: f.kind, date: f.date as ISODate, odometer });
  if (err) return { error: err };
  let until = f.status === "booked" ? f.until : "";
  if (f.status === "booked" && (!until || until < f.date)) until = f.date;
  return {
    body: {
      vehicleId,
      status: f.status,
      kind: f.kind,
      date: f.date,
      until,
      provider,
      odometer,
      cost: done ? f.cost.trim() : null,
      ref: f.ref.trim(),
      description: f.description.trim(),
      // A booking keeps whatever work the visit already had (saveRecord).
      work: done ? f.work.filter((w) => w.d.trim()).map((w) => ({ d: w.d.trim(), cost: w.cost.trim(), chk: w.chk })) : (rec && rec.work) || [],
      warrantyUntil: done ? f.warrantyUntil : "",
      checkedBy: done ? f.checkedBy.trim() : "",
      files: f.files,
      nextDate: done ? f.nextDate : "",
      nextKm: done ? toKm(f.nextKm) : null,
      updateLastService: done && f.kind === "Service" && f.updateLastService,
      disc: done && f.kind === "Licence renewal" ? f.disc : "",
      mins,
    },
  };
}

export const needsOdometer = (kind: string) => kind === "Service" || kind === B2B_KIND;
