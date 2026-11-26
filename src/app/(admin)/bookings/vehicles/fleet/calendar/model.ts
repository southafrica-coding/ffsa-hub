// The Calendar's data (SPEC 5.6; the Fleet app's calendarView, clashHTML, dueVisits,
// 'book-pick' and the gap finder) as pure functions of FleetData. The page and the client
// components only draw what these return.

import type { VisitPrefill } from "../[vehicleId]/visit-dialog";
import {
  KM_RULES,
  SEV_RANK,
  addDays,
  alternatives,
  clashList,
  clashNote,
  dueKind,
  fmtKm,
  fmtRange,
  inUse,
  kindShort,
  kmAlerts,
  kmPlan,
  projText,
  suggestGap,
  tripName,
  tripOn,
  visitNotices,
  weekStartOf,
  weekly,
  worst,
  wsEvents,
  type FleetData,
  type ISODate,
  type Sev,
} from "@/lib/fleet/rules";
import type { Visit } from "../[vehicleId]/model";
import { outKindOf } from "@/lib/fleet/out-of-action";

export type Gap = { from: ISODate; to: ISODate } | null;

// ── The booking board's Fleet lane ─────────────────────────

export interface BoardLane {
  /** Workshop visits in the window, flagged when a booking overlaps them. */
  visits: { id: string; from: ISODate; to: ISODate; label: string; tip: string; clash: boolean }[];
  /** The routine check on its inspection day: planned, done or overdue (as the Fleet grid). */
  checks: { date: ISODate; st: "plan" | "done" | "late"; tip: string }[];
  /** Fleet 5c: in for a repair or broken down, since when (until marked back). */
  out?: { since: ISODate | null; label: string } | null;
}
export interface BoardOverlay {
  lanes: Record<string, BoardLane>;
  /** Hub bookings in a clash (a workshop visit, a double booking, a vehicle not in use). */
  clashBookingIds: string[];
}

/** What the booking board draws under each vehicle's bookings (Fleet part 5b): its
 *  workshop visits and inspection days over [from, from + days), and which bookings clash.
 *  The same rules as Fleet's own calendar (wsEvents, weekly, clashList). */
export function boardOverlay(F: FleetData, from: ISODate, days: number): BoardOverlay {
  const to = addDays(from, days - 1);
  const ws = wsEvents(F);
  const clashes = clashList(F);
  const clashVisit = new Set(clashes.filter((c) => c.kind === "overlap" && c.w).map((c) => c.w!.id));
  const clashBookingIds = Array.from(
    new Set(clashes.filter((c) => c.kind !== "near").flatMap((c) => [c.t, c.t0]).filter((t): t is NonNullable<typeof t> => !!t && t.source === "hub").map((t) => t.id.split(":")[0]))
  );
  const thisWs = weekStartOf(F.today);
  const lanes: Record<string, BoardLane> = {};
  // Every vehicle except For sale: a broken-down one ("Off the road") still has bookings to show.
  for (const v of F.vehicles.filter((x) => x.status !== "For sale")) {
    const visits = ws
      .filter((w) => w.vehicleId === v.id && w.to >= from && w.from <= to)
      .map((w) => {
        const what = kindShort(w.kind);
        return {
          id: w.id,
          from: w.from,
          to: w.to,
          label: `${what}${w.provider ? " · " + w.provider : ""}`,
          tip: `${what}${w.provider ? " at " + w.provider : ""}: ${fmtRange(w.from, w.to)}`,
          clash: clashVisit.has(w.id),
        };
      });
    const checks: BoardLane["checks"] = [];
    const seenWeeks = new Set<string>();
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const wsd = weekStartOf(d);
      if (wsd < thisWs || seenWeeks.has(wsd)) continue;
      const w = weekly(F, v, wsd);
      if (w.date !== d || ["skip", "none"].includes(w.st)) continue;
      seenWeeks.add(wsd);
      if (tripOn(F, v.id, d) || ws.some((x) => x.vehicleId === v.id && x.from <= d && d <= x.to)) continue;
      checks.push({ date: d, st: w.st === "done" ? "done" : w.st === "overdue" ? "late" : "plan", tip: `${w.name}: ${w.label}` });
    }
    const kind = outKindOf(v);
    const out = kind ? { since: v.statusSince ?? null, label: kind === "repair" ? "IN FOR A REPAIR" : "BROKEN DOWN" } : null;
    if (visits.length || checks.length || out) lanes[v.id] = { visits, checks, out };
  }
  return { lanes, clashBookingIds };
}

// ── Clashes and heads-ups ──────────────────────────────────

export interface ClashItem {
  sev: Sev;
  vehicleId: string;
  vehicleName: string;
  text: string;
  note: string;
  /** "Move <trip> to <vehicle>": only Hub bookings can be moved from here. */
  moves: { trip: { id: string; label: string; from: ISODate; to: ISODate }; to: { id: string; name: string } }[];
  /** "Move the workshop visit to <first free 48 hours>", for a booked visit. */
  wsMove: { visit: Visit; from: ISODate; to: ISODate } | null;
  /** "Let them know": a Hub booking a workshop visit clashes with, or starts soon after
   *  (SPEC 7.3). Sent only when the co-ordinator taps it, through the booking notice. */
  notify: { bookingId: string; visitId: string; text: string } | null;
}

/** Every clash and heads-up, worst first, with what can be done about it. */
export function clashItems(F: FleetData): ClashItem[] {
  const names = Object.fromEntries(F.vehicles.map((v) => [v.id, v.name]));
  return clashList(F)
    .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev])
    .map((c) => {
      const solve = !!c.t && c.kind !== "near";
      const t = c.t;
      const moves =
        solve && t && t.source === "hub"
          ? alternatives(F, t).map((a) => ({ trip: { id: t.id, label: tripName(t), from: t.from, to: t.to }, to: { id: a.id, name: a.name } }))
          : [];
      let wsMove: ClashItem["wsMove"] = null;
      if (solve && c.w && c.w.rec) {
        const g = suggestGap(F, c.vehicleId, { ignore: c.w.id });
        if (g) wsMove = { visit: c.w.rec as unknown as Visit, from: g.from, to: g.to };
      }
      const bookingId = t ? t.id.split(":")[0] : "";
      const notice = c.w && t && t.source === "hub" && (c.kind === "overlap" || c.kind === "near") ? visitNotices(F, c.w.id).find((n) => n.bookingId === bookingId) : undefined;
      const notify = notice && c.w ? { bookingId, visitId: c.w.id, text: notice.text } : null;
      return { sev: c.sev, vehicleId: c.vehicleId, vehicleName: names[c.vehicleId] || "Vehicle", text: c.text, note: clashNote(F, c), moves, wsMove, notify };
    });
}

// ── Book a workshop visit ──────────────────────────────────

export interface DueItem {
  id: string;
  name: string;
  sev: "crit" | "warn" | "ok";
  text: string;
  /** "First free 48 hours: …" or "No free 48 hours in the next few months", plus the projection. */
  when: string;
  gap: Gap;
  kind: string;
}

/** Vehicles due by km (the app's dueVisits), each with its first free 48 hours. */
export function dueItems(F: FleetData): DueItem[] {
  return F.vehicles
    .filter(inUse)
    .map((v) => ({ v, a: kmAlerts(F, v).filter((a) => a.sev !== "info"), p: kmPlan(v) }))
    .filter((x) => x.a.length)
    .map(({ v, a, p }) => {
      const g = suggestGap(F, v.id);
      const pt = projText(v, p.combined || !p.inspect ? p.service : p.inspect, F.today);
      return {
        id: v.id,
        name: v.name,
        sev: worst(a),
        text: a.map((x) => x.text.replace(/: book it at the workshop$/, "")).join(" · "),
        when: (g ? "First free 48 hours: " + fmtRange(g.from, g.to) : "No free 48 hours in the next few months") + (pt ? " · " + pt : ""),
        gap: g,
        kind: dueKind(p),
      };
    });
}

export const noneDueText = () => `No service or bumper-to-bumper inspection is due within ${fmtKm(KM_RULES.warn)}.`;

/** "No service km on record yet for …" (empty when every vehicle in use has one). */
export function missingServiceText(F: FleetData): string {
  const missing = F.vehicles.filter(inUse).filter((v) => !kmPlan(v).service);
  return missing.length ? `No service km on record yet for ${missing.map((v) => v.name).join(", ")}, so their next service can’t be worked out.` : "";
}

export interface GapChoice {
  id: string;
  name: string;
  gap: Gap;
  kind: string;
}

/** Every vehicle in use with its first free 48 hours: the 'book-pick' list and the gap finder. */
export function gapChoices(F: FleetData): GapChoice[] {
  return F.vehicles.filter(inUse).map((v) => ({ id: v.id, name: v.name, gap: suggestGap(F, v.id), kind: dueKind(kmPlan(v)) }));
}

/** The booking form's starting values for a vehicle and a free 48 hours (the app's 'book-gap').
 *  Here, not in calendar-client, because the server-rendered sections call it too. */
export function bookPrefill(c: { gap: GapChoice["gap"]; kind: string }, provider: string, today: string): VisitPrefill {
  const from = c.gap ? c.gap.from : today;
  return { kind: c.kind, date: from, until: c.gap ? c.gap.to : from, provider };
}
