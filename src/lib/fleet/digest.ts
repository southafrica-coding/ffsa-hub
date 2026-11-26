// The Fleet half of the 07:00 vehicles message from the FFSA Hub Activity bot (Gideon,
// 19 Nov 2026). The message has two parts:
//
//   • Bookings — everything about bookings. Fleet adds its clashes (a booking over a
//     workshop visit, or a double booking) and the pre- and post-rental inspections for
//     vehicles going out or coming back today.
//   • Fleet — every vehicle, marked IN (not booked, not at the workshop) or OUT (booked
//     or at the workshop). An IN vehicle lists what's due on it: inspections, service,
//     bumper-to-bumper inspection, workshop visits, faults or damage reported, licence
//     disc. An OUT vehicle shows only who has it: the team or person, or the workshop.
//
// What's due comes from the tested rules (buildReminder per vehicle, condCounts,
// vehicleAlerts); this file only sorts it by vehicle. The rules are not changed here.

import {
  B2B_KIND,
  buildReminder,
  condCounts,
  fmtShort,
  kindShort,
  plural,
  vehicleAlerts,
  type FleetData,
  type FleetVehicle,
  type ISODate,
  type ReminderKey,
  type Trip,
  type WorkshopVisit,
} from "./rules";

export type InOut = "in" | "out" | "off";

export interface DigestVehicle {
  id: string;
  /** "Hyundai H1 #1 (CA 123-456)" */
  label: string;
  state: InOut;
  /** OUT: who has it ("HULC · Jane Doe, back Sat 21 Nov"). OFF: its status. IN: empty. */
  where: string;
  /** IN only: what's due on it. Empty when nothing is. */
  due: string[];
}

export interface FleetDigest {
  /** Lines for the Bookings part. */
  clashes: string[];
  tripChecks: string[];
  /** One entry per vehicle, in name order. */
  vehicles: DigestVehicle[];
}

const NOT_IN_USE = ["For sale", "Off the road"];
const labelOf = (v: FleetVehicle) => `${v.name}${v.reg ? ` (${v.reg})` : ""}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The reminder writes "H1 (CA 1) – weekly check"; under the vehicle's own heading the name is noise. */
function stripName(line: string, v: FleetVehicle): string {
  for (const p of [labelOf(v), v.name]) {
    if (line.startsWith(p)) return cap(line.slice(p.length).replace(/^\s*[–:]\s*|^\s+/, ""));
  }
  return cap(line);
}

const covers = (from: ISODate | null | undefined, to: ISODate | null | undefined, d: ISODate) => !!from && from <= d && d <= (to || from);

function tripToday(F: FleetData, v: FleetVehicle, today: ISODate): Trip | null {
  return F.trips.find((t) => t.vehicleId === v.id && covers(t.from, t.to, today)) ?? null;
}

function visitToday(F: FleetData, v: FleetVehicle, today: ISODate): WorkshopVisit | null {
  const booked = F.visits.filter((r) => r.vehicleId === v.id && r.status === "booked");
  return booked.find((r) => covers(r.date, r.until, today)) ?? null;
}

function whoHasIt(t: Trip, today: ISODate): string {
  const name = t.label || "a booking";
  const who = t.who && t.who !== t.label ? ` · ${t.who}` : "";
  return `${name}${who}, back ${t.to === today ? "today" : fmtShort(t.to)}`;
}

function workshopText(v: FleetVehicle, r: WorkshopVisit | null): string {
  const kind = r ? kindShort(r.kind) : v.followUp?.kind ? kindShort(v.followUp.kind) : null;
  const where = r?.provider || v.followUp?.provider || "the workshop";
  const since = v.status === "In workshop" && v.statusSince ? `, since ${fmtShort(v.statusSince)}` : "";
  const until = r?.until && r.until !== r.date ? `, until ${fmtShort(r.until)}` : "";
  return `At ${where}${kind ? ` (${kind === B2B_KIND ? "Bumper-to-bumper inspection" : kind})` : ""}${since}${until}`;
}

/** Sections of one vehicle's reminder that describe the vehicle itself (clashes and trips are handled apart). */
const DUE_SECTIONS: [ReminderKey, (s: string) => string][] = [
  ["today", (s) => `${s} due today`],
  ["tomorrow", (s) => `${s} due tomorrow`],
  ["in2", (s) => `${s} due in 2 days`],
  ["still", (s) => s],
  ["postponed", (s) => s],
  ["workshop", (s) => s],
  ["km", (s) => s],
  // Not "cards": the in-car guide (Manual tab) isn't in the Hub yet.
];

export function buildFleetDigest(F: FleetData, today: ISODate): FleetDigest {
  const out: FleetDigest = { clashes: [], tripChecks: [], vehicles: [] };
  const vehicles = [...F.vehicles].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  for (const v of vehicles) {
    // This vehicle's slice of the 07:00 reminder, from the same rules.
    const r = buildReminder(
      {
        vehicles: [v],
        trips: F.trips.filter((t) => t.vehicleId === v.id),
        visits: F.visits.filter((x) => x.vehicleId === v.id),
        checklist: F.checklist,
        schedule: F.schedule,
      },
      today,
      { appUrl: "" }
    );
    out.clashes.push(...r.sections.clashes);

    const trip = tripToday(F, v, today);
    const visit = visitToday(F, v, today);
    const label = labelOf(v);

    if (trip || visit || v.status === "In workshop" || v.status === "On a trip") {
      // OUT: only who has it. Checks for a trip leaving or ending today go under Bookings.
      out.tripChecks.push(...r.sections.trips);
      const where = trip ? whoHasIt(trip, today) : visit || v.status === "In workshop" ? workshopText(v, visit) : "On a trip";
      out.vehicles.push({ id: v.id, label, state: "out", where, due: [] });
      continue;
    }
    if (NOT_IN_USE.includes(v.status || "")) {
      out.vehicles.push({ id: v.id, label, state: "off", where: v.status || "", due: [] });
      continue;
    }

    const due: string[] = [];
    for (const [key, say] of DUE_SECTIONS) for (const line of r.sections[key]) due.push(say(stripName(line, v)));
    for (const line of r.sections.trips) due.push(stripName(line, v));
    const c = condCounts(F.checklist, v);
    if (c.fix) due.push(`${c.fix} ${c.fix === 1 ? "fault or damage" : "faults or damage"} reported (Fix now)`);
    if (c.mon) due.push(`${plural(c.mon, "item")} to monitor`);
    for (const a of vehicleAlerts({ ...F, today }, v))
      if (a.text.startsWith("Licence disc") && a.sev !== "info") due.push(a.text);
    out.vehicles.push({ id: v.id, label, state: "in", where: "", due });
  }
  return out;
}

// ── Slack ───────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Blocks Fleet adds to the Bookings part (nothing when there's nothing to say). */
export function fleetBookingParts(d: FleetDigest, calendarUrl: string): string[] {
  const parts: string[] = [];
  if (d.clashes.length)
    parts.push(`*⚠️ Clashes (${d.clashes.length}) – <${calendarUrl}|sort them out on the Calendar>*\n${d.clashes.map((l) => "• " + esc(l)).join("\n")}`);
  if (d.tripChecks.length) parts.push(`*🔍 Pre- and post-rental inspections (${d.tripChecks.length})*\n${d.tripChecks.map((l) => "• " + esc(l)).join("\n")}`);
  return parts;
}

const MARK: Record<InOut, string> = { in: "🟢 *IN*", out: "🔴 *OUT*", off: "⚪ *OFF*" };

/** The Fleet part: one block per vehicle. */
export function fleetVehicleParts(d: FleetDigest): string[] {
  return d.vehicles.map((v) => {
    const head = `${MARK[v.state]}  *${esc(v.label)}*`;
    if (v.state !== "in") return `${head}\n${esc(v.where)}`;
    return v.due.length ? `${head}\n${v.due.map((l) => "• " + esc(l)).join("\n")}` : `${head}\nNothing due`;
  });
}

/** Lines that need doing, counted toward the message's "N things to know". */
export const fleetDigestCount = (d: FleetDigest) =>
  d.clashes.length + d.tripChecks.length + d.vehicles.reduce((n, v) => n + v.due.length, 0);
