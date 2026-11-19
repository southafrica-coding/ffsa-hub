// The Calendar's data (SPEC 5.6; the Fleet app's calendarView, clashHTML, dueVisits,
// 'book-pick' and the gap finder) as pure functions of FleetData. The page and the client
// components only draw what these return.

import type { VisitPrefill } from "../[vehicleId]/visit-dialog";
import {
  CAL_DAYS,
  KM_RULES,
  SEV_RANK,
  addDays,
  alternatives,
  clashList,
  clashNote,
  dueKind,
  fmtDate,
  fmtKm,
  fmtRange,
  inUse,
  isoWeekday,
  kindShort,
  kmAlerts,
  kmPlan,
  projText,
  suggestGap,
  tripName,
  tripOn,
  weekStartOf,
  weekly,
  worst,
  wsEvents,
  type FleetData,
  type ISODate,
  type Sev,
  type WsEvent,
} from "@/lib/fleet/rules";
import type { Visit } from "../[vehicleId]/model";

export type Gap = { from: ISODate; to: ISODate } | null;

const DAY2 = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // the app's DAYS[n].slice(0, 2)

/** The first day shown: the Monday of ?start= (when it's a real date), else this week's. */
export function calStartOf(param: string | string[] | undefined, today: ISODate): ISODate {
  const s = Array.isArray(param) ? param[0] : param;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && addDays(s, 0) === s) return weekStartOf(s);
  return weekStartOf(today);
}

/** The ?start= for Week back (-7), This week (0) and Week forward (7), as 'cal-move' does. */
export function calMoveHref(base: string, start: ISODate, n: number): string {
  return n === 0 ? base : `${base}?start=${addDays(start, n)}`;
}

// ── Timeline ───────────────────────────────────────────────

export interface CalDay {
  date: ISODate;
  dow: string;
  num: number;
  weekend: boolean;
  today: boolean;
}

export type MarkKind = "trip" | "ws" | "clash";
export interface CalCell {
  date: ISODate;
  weekend: boolean;
  today: boolean;
  /** A trip, workshop visit or clash bar; s/e = it starts/ends in this cell. */
  mark?: { c: MarkKind; s: boolean; e: boolean };
  /** The routine check on its inspection day: planned ring, filled when done, red when overdue. */
  check?: "plan" | "done" | "late";
  tip: string;
}
export interface CalRow {
  id: string;
  name: string;
  cells: CalCell[];
}
export interface CalGrid {
  start: ISODate;
  end: ISODate;
  label: string;
  days: CalDay[];
  rows: CalRow[];
}

type Key = { k: string; c: MarkKind; tip: string } | null;

function keyOf(F: FleetData, ws: WsEvent[], vid: string, d: ISODate): Key {
  const t = tripOn(F, vid, d);
  const w = ws.find((x) => x.vehicleId === vid && x.from <= d && d <= x.to);
  if (t && w) return { k: "x" + t.id + w.id, c: "clash", tip: `Clash: ${kindShort(w.kind)} and ${tripName(t)}` };
  if (t) return { k: "t" + t.id, c: "trip", tip: `${tripName(t)}: ${fmtRange(t.from, t.to)}` };
  if (w) return { k: "w" + w.id, c: "ws", tip: `${kindShort(w.kind)}${w.provider ? " at " + w.provider : ""}: ${fmtRange(w.from, w.to)}` };
  return null;
}

/** Four weeks from `start`, one row per vehicle in use. */
export function calendarGrid(F: FleetData, start: ISODate): CalGrid {
  const today = F.today;
  const dates = Array.from({ length: CAL_DAYS }, (_, i) => addDays(start, i));
  const end = dates[dates.length - 1];
  const ws = wsEvents(F);
  const thisWs = weekStartOf(today);
  const wk: Record<string, ReturnType<typeof weekly>> = {};
  const days: CalDay[] = dates.map((d) => ({
    date: d,
    dow: DAY2[isoWeekday(d) - 1],
    num: Number(d.slice(8)),
    weekend: isoWeekday(d) > 5,
    today: d === today,
  }));
  const rows = F.vehicles.filter(inUse).map((v) => {
    const weekOf = (d: ISODate) => {
      const k = v.id + weekStartOf(d);
      return wk[k] || (wk[k] = weekly(F, v, weekStartOf(d)));
    };
    const cells = days.map((day): CalCell => {
      const d = day.date;
      const cell: CalCell = { date: d, weekend: day.weekend, today: day.today, tip: "" };
      const k = keyOf(F, ws, v.id, d);
      if (k) {
        const pk = keyOf(F, ws, v.id, addDays(d, -1));
        const nk = keyOf(F, ws, v.id, addDays(d, 1));
        cell.mark = { c: k.c, s: !pk || pk.k !== k.k, e: !nk || nk.k !== k.k };
        cell.tip = k.tip;
      } else if (weekStartOf(d) >= thisWs) {
        const w = weekOf(d);
        if (w.date === d && !["skip", "none"].includes(w.st)) {
          cell.check = w.st === "done" ? "done" : w.st === "overdue" ? "late" : "plan";
          cell.tip = `${w.name}: ${w.label}`;
        }
      }
      return cell;
    });
    return { id: v.id, name: v.name, cells };
  });
  return { start, end, label: `${fmtDate(start)} – ${fmtDate(end)}`, days, rows };
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
      return { sev: c.sev, vehicleId: c.vehicleId, vehicleName: names[c.vehicleId] || "Vehicle", text: c.text, note: clashNote(F, c), moves, wsMove };
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

// ── List view ──────────────────────────────────────────────

export interface ListItem {
  date: ISODate;
  vehicleId: string;
  vehicleName: string;
  dot: "info" | "warn";
  text: string;
}

/** Trips and workshop visits in the four weeks that haven't ended, by start date. */
export function listItems(F: FleetData, start: ISODate): ListItem[] {
  const today = F.today;
  const end = addDays(start, CAL_DAYS - 1);
  const names = Object.fromEntries(F.vehicles.map((v) => [v.id, v.name]));
  return [
    ...F.trips
      .filter((t) => t.to >= today && t.from <= end)
      .map((t) => ({ date: t.from, vehicleId: t.vehicleId, dot: "info" as const, text: `${tripName(t)} · ${fmtRange(t.from, t.to)}` })),
    ...wsEvents(F)
      .filter((w) => w.to >= today && w.from <= end)
      .map((w) => ({ date: w.from, vehicleId: w.vehicleId, dot: "warn" as const, text: `${kindShort(w.kind)}${w.provider ? " at " + w.provider : ""} · ${fmtRange(w.from, w.to)}` })),
  ]
    .filter((x) => names[x.vehicleId])
    .map((x) => ({ ...x, vehicleName: names[x.vehicleId] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The booking form's starting values for a vehicle and a free 48 hours (the app's 'book-gap').
 *  Here, not in calendar-client, because the server-rendered sections call it too. */
export function bookPrefill(c: { gap: GapChoice["gap"]; kind: string }, provider: string, today: string): VisitPrefill {
  const from = c.gap ? c.gap.from : today;
  return { kind: c.kind, date: from, until: c.gap ? c.gap.to : from, provider };
}
