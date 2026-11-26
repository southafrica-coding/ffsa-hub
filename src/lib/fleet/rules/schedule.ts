// Inspection schedule: which day each vehicle is checked, and where its routine check stands
// in a given week (SPEC 6.1). Reference: schedule, weeklyOnly, weekly in
// vehicles-module/app/ffsa-fleet.html. Ported line by line.

import { AWAY, typeOf } from "./constants";
import { activeTrip, tripName, tripOn } from "./bookings";
import { itemsFor } from "./checklist";
import { addDays, fmtDay, weekStartOf } from "./format";
import type { FleetData, FleetVehicle, ISODate } from "./types";

export function schedule(F: FleetData) {
  const c = F.schedule;
  if (c && Array.isArray(c.days) && c.days.length)
    return {
      days: [...c.days].map(Number).sort((a, b) => a - b),
      max: c.maxPerDay || 2,
      assign: Object.assign({}, c.assign || {}) as Record<string, number>,
      saved: true,
    };
  const days = [2, 3, 4],
    max = 2,
    assign: Record<string, number> = {},
    load: Record<number, number> = { 2: 0, 3: 0, 4: 0 };
  for (const v of F.vehicles) {
    if (v.status === "For sale") continue;
    const d = days.find((x) => load[x] < max);
    if (d) {
      assign[v.id] = d;
      load[d]++;
    }
  }
  return { days, max, assign, saved: false };
}

export const weeklyOnly = (F: FleetData, ws: ISODate): boolean =>
  !!(F.schedule && Array.isArray(F.schedule.weeklyOnly) && F.schedule.weeklyOnly.includes(ws));

export type WeeklyState = "done" | "skip" | "none" | "away" | "planned" | "postponed" | "today" | "due" | "overdue";
export interface Weekly {
  wd: number | null;
  date: ISODate | null;
  type: "weekly" | "monthly";
  name: string;
  st: WeeklyState;
  label: string;
  back?: ISODate;
}

/** Where a vehicle's routine check stands in the week starting ws (a Monday). */
export function weekly(F: FleetData, v: FleetVehicle, ws?: ISODate): Weekly {
  const today = F.today;
  ws = ws || weekStartOf(today);
  const we = addDays(ws, 6);
  const sc = schedule(F);
  const wd = Number(sc.assign[v.id]) || null;
  const date = wd ? addDays(ws, wd - 1) : null;
  const ms = (date || today).slice(0, 8) + "01";
  const type: Weekly["type"] =
    itemsFor(F.checklist, "monthly").length > itemsFor(F.checklist, "weekly").length &&
    !(v.lastMonthly && (v.lastMonthly.date || "") >= ms) &&
    !weeklyOnly(F, ws)
      ? "monthly"
      : "weekly";
  const r = { wd, date, type, name: type === "monthly" ? "Monthly check" : "Weekly check" };
  const done = (st: WeeklyState, label: string, extra?: Partial<Weekly>): Weekly => Object.assign(r, { st, label }, extra || {});

  const lc = v.lastCheck && v.lastCheck.date;
  if (lc && lc >= ws && lc <= we) {
    r.type = typeOf(v.lastCheck?.type).id === "monthly" ? "monthly" : "weekly";
    r.name = typeOf(r.type).label;
    return done("done", "Done " + fmtDay(lc));
  }
  if (v.status === "For sale" || v.status === "Off the road")
    return done("skip", "Not checked while " + v.status.toLowerCase());
  if (!wd || !r.date) return done("none", "No inspection day set");
  const awayText = v.status === "On a trip" ? "on a trip" : "at the workshop";
  const tPlan = tripOn(F, v.id, r.date);
  if (ws > today || r.date > today) {
    if (tPlan) return done("away", `Away until ${fmtDay(tPlan.to)} (${tripName(tPlan)})`);
    return done("planned", fmtDay(r.date) + (ws <= today && AWAY.includes(v.status || "") ? ` (now ${awayText})` : ""));
  }
  const tNow = activeTrip(F, v);
  if (tNow) return done("postponed", `Postponed: away until ${fmtDay(tNow.to)} (${tripName(tNow)}). Check when it’s back`);
  if (AWAY.includes(v.status || "")) return done("postponed", `Postponed: ${awayText}. Check when it’s back`);
  if (r.date === today) return done("today", "Due today");
  const backs: ISODate[] = [];
  if (v.statusSince && v.statusSince >= r.date) backs.push(v.statusSince);
  if (tPlan) backs.push(tPlan.to);
  const back = backs.sort().pop();
  if (back) return done("due", "Due now: back since " + fmtDay(back), { back });
  return done("overdue", "Overdue: planned for " + fmtDay(r.date));
}
