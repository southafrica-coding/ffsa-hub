// The daily 07:00 reminder (SPEC 6.11). Ported line by line from
// vehicles-module/server/reminder.js (buildReminder), which matches the claude.ai scheduled
// task it replaces. Note that it has its own km wording (no "km" suffix in fmtNum) and its
// own monthly test; keep both as they are.

import { addDays, dayName, fmtShort, isoWeekday, monthStart, weekStartOf } from "./format";
import type { FleetData, FleetVehicle, ISODate, Trip } from "./types";

const KM = { inspect: 5000, service: 10000, warn: 500 };
const B2B = "Workshop inspection (bumper to bumper)";
const SERVICE = "Service";
const SKIP = ["For sale", "Off the road"];
const AWAY = ["On a trip", "In workshop"];

/** Plain spaces, as reminder.js (Slack and email text). */
const fmtNum = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const range = (a: ISODate, b?: ISODate | null) => (!b || a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);
const overlaps = (a1: ISODate, a2: ISODate, b1: ISODate, b2: ISODate) => a1 <= b2 && b1 <= a2;

export const REMINDER_SECTIONS = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["in2", "In 2 days"],
  ["still", "Still to do this week"],
  ["clashes", "Clashes"],
  ["trips", "Trips"],
  ["postponed", "Postponed"],
  ["workshop", "Workshop visits"],
  ["km", "Services and inspections"],
  ["cards", "In-car guides"],
] as const;
export type ReminderKey = (typeof REMINDER_SECTIONS)[number][0];
export type ReminderSections = Record<ReminderKey, string[]>;

export interface Reminder {
  subject: string;
  text: string;
  sections: ReminderSections;
  empty: boolean;
}

export function buildReminder(
  F: Pick<FleetData, "vehicles" | "trips" | "visits" | "checklist" | "schedule">,
  today: ISODate,
  opts: { appUrl: string; linkText?: string }
): Reminder {
  const sched = F.schedule || {};
  const assign = sched.assign || {};
  const weeklyOnly = sched.weeklyOnly || [];
  const checklist = F.checklist;
  const monthlyInUse = !!(
    checklist && (checklist.sections || []).some((s) => (s.items || []).some((i) => (i.in || []).includes("monthly")))
  );

  const fleet = F.vehicles;
  const trips = F.trips;
  const records = F.visits;
  const label = (v: FleetVehicle) => `${v.name}${v.reg ? ` (${v.reg})` : ""}`;
  const tripsOf = (vid: string) => trips.filter((t) => t.vehicleId === vid && t.from && t.to);
  const tripOn = (vid: string, d: ISODate) => tripsOf(vid).find((t) => t.from <= d && d <= t.to);
  const active = fleet.filter((v) => !SKIP.includes(v.status || ""));
  const planned = (v: FleetVehicle, d: ISODate) => addDays(weekStartOf(d), Number(assign[v.id]) - 1);
  const doneInWeek = (v: FleetVehicle, ws: ISODate) =>
    !!(v.lastCheck && v.lastCheck.date && v.lastCheck.date >= ws && v.lastCheck.date <= addDays(ws, 6));
  const kindFor = (v: FleetVehicle, p: ISODate) =>
    monthlyInUse && !weeklyOnly.includes(weekStartOf(p)) && !(v.lastMonthly && v.lastMonthly.date && v.lastMonthly.date >= monthStart(p))
      ? "monthly check"
      : "weekly check";

  const S: ReminderSections = { today: [], tomorrow: [], in2: [], still: [], clashes: [], trips: [], postponed: [], workshop: [], km: [], cards: [] };
  const scheduled = active.filter((v) => assign[v.id]);

  // Today, tomorrow and the day after
  ([["today", 0], ["tomorrow", 1], ["in2", 2]] as const).forEach(([key, n]) => {
    const day = addDays(today, n);
    for (const v of scheduled) {
      if (Number(assign[v.id]) !== isoWeekday(day) || doneInWeek(v, weekStartOf(day))) continue;
      const t = tripOn(v.id, day);
      if (t) S.postponed.push(`${label(v)}: away until ${fmtShort(t.to)} (${t.label || "trip"}), check when it's back`);
      else if (AWAY.includes(v.status || "")) S.postponed.push(`${label(v)}: ${v.status === "On a trip" ? "on a trip" : "at the workshop"}, check when it's back`);
      else S[key].push(`${label(v)} – ${kindFor(v, day)}`);
    }
  });

  // Still to do this week
  const ws = weekStartOf(today);
  for (const v of scheduled) {
    const p = planned(v, today);
    if (p >= today || doneInWeek(v, ws)) continue;
    if (tripOn(v.id, today) || AWAY.includes(v.status || "")) continue;
    const endedTrip = tripsOf(v.id)
      .filter((t) => t.from <= p && p <= t.to && t.to < today)
      .sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    const back = v.statusSince && v.statusSince >= p ? v.statusSince : endedTrip ? endedTrip.to : null;
    S.still.push(`${label(v)} – ${kindFor(v, p)}, ${back ? `back since ${fmtShort(back)}, check now` : `overdue since ${dayName(p)} ${fmtShort(p)}`}`);
  }

  // Workshop visits = booked records + each vehicle's followUp (not counted twice)
  const bookedIds = new Set(records.filter((r) => r.status === "booked").map((r) => r.id));
  const visits = records
    .filter((r) => r.status === "booked" && r.date)
    .map((r) => ({ vehicleId: r.vehicleId, from: r.date as ISODate, to: (r.until || r.date) as ISODate, kind: r.kind || "Workshop visit", provider: r.provider || "" }));
  for (const v of fleet) {
    const f = v.followUp;
    if (f && f.date && !(f.recId && bookedIds.has(f.recId)))
      visits.push({ vehicleId: v.id, from: f.date, to: f.until || f.date, kind: f.kind || "Workshop visit", provider: f.provider || "" });
  }
  const vmap = Object.fromEntries(fleet.map((v) => [v.id, v]));

  // Clashes
  for (const w of visits) {
    if (w.to < today || !vmap[w.vehicleId]) continue;
    for (const t of tripsOf(w.vehicleId)) {
      if (t.to >= today && overlaps(w.from, w.to, t.from, t.to))
        S.clashes.push(`${vmap[w.vehicleId].name}: ${w.kind} (${range(w.from, w.to)}) clashes with ${t.label || "a trip"} (${range(t.from, t.to)}), sort it out on the Calendar page`);
    }
  }
  for (const v of fleet) {
    const ts: Trip[] = tripsOf(v.id).filter((t) => t.to >= today);
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        if (overlaps(ts[i].from, ts[i].to, ts[j].from, ts[j].to))
          S.clashes.push(`${v.name}: double booked, ${ts[i].label || "trip"} (${range(ts[i].from, ts[i].to)}) and ${ts[j].label || "trip"} (${range(ts[j].from, ts[j].to)})`);
      }
  }

  // Trips leaving and coming back
  const tomorrow = addDays(today, 1),
    yesterday = addDays(today, -1);
  for (const t of trips) {
    const v = vmap[t.vehicleId];
    if (!v) continue;
    if (t.from === today || t.from === tomorrow)
      S.trips.push(`${label(v)} leaves ${t.from === today ? "today" : "tomorrow"} (${t.label || "trip"}, back ${fmtShort(t.to)}): do a pre-trip check`);
    if ((t.to === yesterday || t.to === today) && !(v.lastPost && v.lastPost.date && v.lastPost.date >= t.to))
      S.trips.push(`${label(v)} is back from ${t.label || "a trip"} (${fmtShort(t.to)}): do a post-trip check`);
  }

  // Workshop visits today or tomorrow
  for (const v of fleet) {
    const f = v.followUp;
    if (f && (f.date === today || f.date === tomorrow))
      S.workshop.push(`${label(v)}: ${f.kind || "workshop visit"}${f.provider ? ` at ${f.provider}` : ""}, ${f.date === today ? "today" : "tomorrow"}`);
  }

  // Services and inspections by km
  for (const v of active) {
    const odo = Number(v.odometer);
    if (!(odo > 0)) continue;
    const ls = v.lastService && Number(v.lastService.km) > 0 ? Number(v.lastService.km) : null;
    const lb = v.lastB2B && Number(v.lastB2B.km) > 0 ? Number(v.lastB2B.km) : null;
    if (ls == null && lb == null) continue;
    const every = Number(v.serviceKm) > 0 ? Number(v.serviceKm) : KM.service;
    const svcKm = ls != null ? ls + every : null;
    const insKm = Math.max(ls || 0, lb || 0) + KM.inspect;
    const left = (km: number) => km - odo;
    const booked = (kinds: string[]) => visits.some((w) => w.vehicleId === v.id && w.to >= today && kinds.includes(w.kind));
    const bookedAs = (kind: string) => visits.find((w) => w.vehicleId === v.id && w.to >= today && w.kind === kind);
    const due = (name: string, km: number) =>
      left(km) < 0
        ? `${label(v)}: ${name} overdue by ${fmtNum(-left(km))} km (was due at ${fmtNum(km)} km)`
        : `${label(v)}: ${name} due in ${fmtNum(left(km))} km (at ${fmtNum(km)} km), book it at the workshop`;
    const combined = svcKm != null && (svcKm <= insKm + KM.warn || (left(svcKm) <= KM.warn && left(insKm) <= KM.warn));
    if (combined && svcKm != null) {
      if (left(svcKm) > KM.warn || booked([SERVICE])) continue;
      const b = bookedAs(B2B);
      S.km.push(b ? `${label(v)}: service and bumper-to-bumper inspection due, booked ${fmtShort(b.from)} as an inspection only: ask for a service too` : due("Service and bumper-to-bumper inspection", svcKm));
    } else {
      if (svcKm != null && left(svcKm) <= KM.warn && !booked([SERVICE])) S.km.push(due("Service", svcKm));
      if (left(insKm) <= KM.warn && !booked([B2B, SERVICE])) S.km.push(due("Bumper-to-bumper inspection", insKm));
    }
  }

  // In-car guides (Mondays only)
  if (isoWeekday(today) === 1) {
    for (const v of active) {
      const c = v.cardPrinted;
      if (!c || !c.date) S.cards.push(`${label(v)}: print and laminate the in-car guide (Manual tab)`);
      else if (c.stale) S.cards.push(`${label(v)}: in-car guide out of date, print a new one`);
      else if (addDays(c.date, 182) <= today) S.cards.push(`${label(v)}: in-car guide is 6 months old, print a new one`);
    }
  }

  const empty = REMINDER_SECTIONS.every(([k]) => !S[k].length);
  const count = S.today.length
    ? `${S.today.length} due today`
    : S.tomorrow.length
      ? `nothing due today, ${S.tomorrow.length} due tomorrow`
      : S.in2.length
        ? `nothing due today, ${S.in2.length} due in 2 days`
        : "nothing due today";
  const subject = `FFSA inspections – ${dayName(today)}, ${fmtShort(today)}: ${count}`;
  const body = REMINDER_SECTIONS.filter(([k]) => S[k].length)
    .map(([k, t]) => `${t}\n${S[k].map((l) => "• " + l).join("\n")}`)
    .join("\n\n");
  const text = `${body}\n\n${opts.linkText || "Open the inspection app"}: ${opts.appUrl}`;
  return { subject, text, sections: S, empty };
}
