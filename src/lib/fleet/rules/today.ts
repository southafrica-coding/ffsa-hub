// Today's list and the time tracker (SPEC 5.1, 6.10). Reference: todayTasks, avgMins,
// timePanel, budgetMins in vehicles-module/app/ffsa-fleet.html. Ported line by line; the
// app's buttons become `action` descriptors the page renders.

import { clashList, inUse, kindShort, suggestGap, tripName, tripsOf, vmapOf, wsEvents } from "./bookings";
import { EST_MIN, SEV_RANK, typeOf } from "./constants";
import { addDays, fmtDay, fmtMins, fmtRange, weekStartOf } from "./format";
import { dueKind, kmAlerts, kmPlan } from "./km";
import { weekly } from "./schedule";
import type { FleetData, FleetVehicle, ISODate, Sev } from "./types";

export type TaskAction =
  | { kind: "start"; type: string }
  | { kind: "dropoff" }
  | { kind: "collect"; recordId: string }
  | { kind: "book"; visitKind: string; from?: ISODate; to?: ISODate }
  | { kind: "calendar" }
  | null;

export interface Task {
  o: number;
  sev: Sev;
  v: FleetVehicle;
  title: string;
  sub: string;
  mins: number;
  action: TaskAction;
}
export interface LaterItem {
  v: FleetVehicle;
  d: ISODate;
  text: string;
}

/** Average minutes for an inspection type from the time log (2+ entries), else the estimate. */
export function avgMins(F: FleetData, type: string): number {
  const xs = (F.timelog || [])
    .filter((x) => x.kind === "inspection" && x.type === type && Number(x.mins) > 0)
    .map((x) => Number(x.mins));
  return xs.length >= 2 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : EST_MIN[type] || 15;
}

export function todayTasks(F: FleetData): { tasks: Task[]; later: LaterItem[] } {
  const today = F.today,
    t1 = addDays(today, 1),
    t2 = addDays(today, 2),
    weekAgo = addDays(today, -7);
  const tasks: Task[] = [],
    later: LaterItem[] = [];
  const ws = wsEvents(F);
  const vs = F.vehicles.filter(inUse);
  for (const v of vs) {
    for (const t of tripsOf(F, v.id)) {
      if (t.from === today)
        tasks.push({ o: 0, sev: "warn", v, title: "Pre-trip check", sub: `Leaves today: ${tripName(t)}, back ${fmtDay(t.to)}`, mins: avgMins(F, "pre"), action: { kind: "start", type: "pre" } });
      else if (t.from === t1 || t.from === t2)
        later.push({ v, d: t.from, text: `Leaves ${t.from === t1 ? "tomorrow" : fmtDay(t.from)} (${tripName(t)}, back ${fmtDay(t.to)}): pre-trip check before it goes` });
      if (t.to <= today && t.to >= weekAgo && !(v.lastPost && (v.lastPost.date || "") >= t.to))
        tasks.push({ o: 1, sev: "warn", v, title: "Post-trip check", sub: `Back from ${tripName(t)} on ${fmtDay(t.to)}: check for damage, km and fuel`, mins: avgMins(F, "post"), action: { kind: "start", type: "post" } });
    }
    for (const w of ws.filter((x) => x.vehicleId === v.id)) {
      if (w.from === today && v.status !== "In workshop")
        tasks.push({ o: 2, sev: "warn", v, title: `Take it to ${w.provider || "the workshop"}`, sub: kindShort(w.kind) + (w.to !== w.from ? `, back ${fmtDay(w.to)}` : ""), mins: 0, action: { kind: "dropoff" } });
      else if (w.from === t1 || w.from === t2)
        later.push({ v, d: w.from, text: `${kindShort(w.kind)} at ${w.provider || "the workshop"} ${w.from === t1 ? "tomorrow" : fmtDay(w.from)}` });
    }
    if (v.status === "In workshop") {
      const w = ws.filter((x) => x.vehicleId === v.id && x.from <= today).pop();
      tasks.push({
        o: 3,
        sev: "info",
        v,
        title: "At the workshop",
        sub: (w ? `${kindShort(w.kind)} at ${w.provider || "the workshop"}${w.to >= today ? ", ready " + fmtDay(w.to) : ""}. ` : "") + "When you collect it, check the work and record what was done.",
        mins: 0,
        action: w && w.rec ? { kind: "collect", recordId: w.rec.id } : null,
      });
    }
    const wk = weekly(F, v);
    if (["today", "due", "overdue"].includes(wk.st))
      tasks.push({ o: wk.st === "overdue" ? 4 : 5, sev: wk.st === "overdue" ? "crit" : "warn", v, title: wk.name, sub: wk.st === "today" ? "Due today" : wk.label, mins: avgMins(F, wk.type), action: { kind: "start", type: wk.type } });
    for (const d of [t1, t2]) {
      const w2 = weekly(F, v, weekStartOf(d));
      if (w2.date === d && w2.st === "planned") later.push({ v, d, text: `${w2.name} ${d === t1 ? "tomorrow" : fmtDay(d)}` });
    }
    for (const a of kmAlerts(F, v).filter((a) => a.sev !== "info")) {
      const g = suggestGap(F, v.id);
      tasks.push({
        o: 6,
        sev: a.sev,
        v,
        title: "Book the workshop",
        sub: a.text.replace(/: book it at the workshop$/, "") + (g ? `. First free 48 hours: ${fmtRange(g.from, g.to)}` : ""),
        mins: 2,
        action: { kind: "book", visitKind: dueKind(kmPlan(v)), from: g?.from, to: g?.to },
      });
    }
  }
  const vmap = vmapOf(F);
  for (const c of clashList(F).filter((c) => c.sev === "crit")) {
    const v = vmap[c.vehicleId];
    if (v) tasks.push({ o: 7, sev: "crit", v, title: "Booking clash", sub: c.text, mins: 3, action: { kind: "calendar" } });
  }
  tasks.sort((a, b) => a.o - b.o || SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  later.sort((a, b) => a.d.localeCompare(b.d));
  return { tasks, later };
}

/** "Time this week" (SPEC 6.10). */
export function timeWeek(F: FleetData) {
  const ws = weekStartOf(F.today);
  const budget = Number((F.schedule && F.schedule.budgetHours) || 5) * 60;
  const all = F.timelog || [];
  const logs = all.filter((x) => x.week === ws);
  const sum = (a: typeof logs) => a.reduce((s, x) => s + (Number(x.mins) || 0), 0);
  const ins = logs.filter((x) => x.kind === "inspection"),
    adm = logs.filter((x) => x.kind !== "inspection");
  const total = sum(logs);
  const averages = ["weekly", "monthly", "post"]
    .map((t) => {
      const n = all.filter((x) => x.kind === "inspection" && x.type === t).length;
      return n >= 2 ? `${typeOf(t).short.toLowerCase()} check ${fmtMins(avgMins(F, t))}` : "";
    })
    .filter(Boolean);
  return {
    total,
    budget,
    pct: Math.min(100, (total / budget) * 100),
    over: total > budget,
    inspections: { mins: sum(ins), count: ins.length },
    admin: { mins: sum(adm) },
    averages,
  };
}
