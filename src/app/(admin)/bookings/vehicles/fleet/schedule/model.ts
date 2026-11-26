// The Schedule screen's data (SPEC 5.7; the Fleet app's scheduleView, board, slotCard,
// kmPanel, schedSettingsHTML, notifyHTML, saveSchedule and setWeeklyOnly). Pure functions
// of FleetData, so the page and the tests read the same thing. The rules themselves live
// in @/lib/fleet/rules and are only called here, never changed.

import {
  AWAY,
  KM_RULES,
  addDays,
  fmtDate,
  fmtDay,
  fmtKm,
  fmtMins,
  fmtRange,
  has,
  kmAlerts,
  kmDueText,
  kmPlan,
  projText,
  schedule,
  timeWeek,
  tripName,
  vmapOf,
  weekStartOf,
  weekly,
  worst,
  wsEvents,
  type FleetData,
  type FleetVehicle,
  type ISODate,
  type WeeklyState,
} from "@/lib/fleet/rules";
import type { Tone } from "@/components/ffsa";
import { DAYS_LONG, ago } from "../vehicles/model";

export const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export { DAYS_LONG };
/** The time budget choices, in hours (the app's s-budget select). */
export const BUDGET_HOURS = [2, 3, 4, 5, 6, 8];
/** The "Most vehicles per day" choices. */
export const MAX_CHOICES = [1, 2, 3];

/** "Tuesday, Wednesday and Thursday" */
export const andList = (a: string[]): string => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The line under the masthead. */
export function scheduleSub(F: FleetData): string {
  const sc = schedule(F);
  return `Weekly checks on ${andList(sc.days.map((d) => DAYS_LONG[d - 1]))}, at most ${plural(sc.max, "vehicle")} a day. The first check each month is the monthly check.`;
}

// ── This week and next week (board, slotCard) ──────────────

export interface SlotCard {
  id: string;
  name: string;
  reg: string | null;
  /** "Monthly check" marker (not shown for skipped / unscheduled vehicles). */
  monthly: boolean;
  st: WeeklyState;
  pill: string;
  tone: Tone;
  /** Start button: the check type, or null when there's nothing to start. */
  start: { type: "weekly" | "monthly"; label: string } | null;
}
export interface DayCol {
  d: number;
  date: ISODate;
  today: boolean;
  cards: SlotCard[];
}
export interface Board {
  title: string;
  ws: ISODate;
  we: ISODate;
  weeklyOnly: boolean;
  /** What the weekly-only switch does to this week's monthly checks. */
  cols: DayCol[];
}

const TONE: Record<WeeklyState, Tone> = {
  done: "good",
  today: "warn",
  due: "warn",
  overdue: "bad",
  postponed: "quiet",
  away: "quiet",
  skip: "quiet",
  none: "quiet",
  planned: "quiet",
};

export function slotCard(F: FleetData, v: FleetVehicle, ws: ISODate): SlotCard {
  const w = weekly(F, v, ws);
  const thisWeek = ws <= F.today;
  const pill =
    w.st === "planned" && thisWeek
      ? "Planned" + (AWAY.includes(v.status || "") ? ` (now ${v.status === "On a trip" ? "on a trip" : "at the workshop"})` : "")
      : w.st === "planned"
        ? "Planned"
        : w.label;
  const startable = thisWeek && ["today", "due", "overdue", "planned"].includes(w.st);
  return {
    id: v.id,
    name: v.name,
    reg: v.reg || null,
    monthly: w.type === "monthly" && w.st !== "skip" && w.st !== "none",
    st: w.st,
    pill,
    tone: TONE[w.st] || "quiet",
    start: startable ? { type: w.type, label: `Start ${w.type === "monthly" ? "monthly" : "weekly"} check` } : null,
  };
}

/** The vehicles that get a monthly check in the week starting ws (none if it's weekly-only). */
export function monthlyIn(F: FleetData, ws: ISODate): FleetVehicle[] {
  return F.vehicles.filter((v) => {
    const w = weekly(F, v, ws);
    return w.type === "monthly" && w.st !== "skip" && w.st !== "none" && w.st !== "done";
  });
}

export function board(F: FleetData, title: string, ws: ISODate): Board {
  const sc = schedule(F);
  return {
    title,
    ws,
    we: addDays(ws, 6),
    weeklyOnly: !!F.schedule?.weeklyOnly?.includes(ws),
    cols: sc.days.map((d) => {
      const date = addDays(ws, d - 1);
      return {
        d,
        date,
        today: date === F.today,
        cards: F.vehicles.filter((v) => Number(sc.assign[v.id]) === d).map((v) => slotCard(F, v, ws)),
      };
    }),
  };
}

export function boards(F: FleetData): Board[] {
  const ws = weekStartOf(F.today);
  return [board(F, "This week", ws), board(F, "Next week", addDays(ws, 7))];
}

// ── Weekly-only weeks (setWeeklyOnly) ──────────────────────

/** The new weekly-only list: drops weeks more than 8 weeks back, as the app does. */
export function setWeeklyOnlyList(list: ISODate[] | undefined, ws: ISODate, on: boolean, today: ISODate): ISODate[] {
  const keep = (list || []).filter((x) => x !== ws && x >= addDays(weekStartOf(today), -56));
  if (on) keep.push(ws);
  return keep.sort();
}

/** Weekly-only weeks other than this week and next (those have their switch on the board). */
export function otherWeeklyOnly(F: FleetData): { ws: ISODate; text: string }[] {
  const ws = weekStartOf(F.today);
  return (F.schedule?.weeklyOnly || [])
    .filter((x) => x !== ws && x !== addDays(ws, 7) && x >= ws)
    .sort()
    .map((x) => ({ ws: x, text: `Week of ${fmtDate(x)} – ${fmtDate(addDays(x, 6))}` }));
}

// ── Services and inspections by km (kmPanel) ───────────────

export interface KmRow {
  id: string;
  name: string;
  reg: string | null;
  sev: "crit" | "warn" | "info" | "ok" | "none";
  text: string;
  booked: ISODate | null;
  odo: string;
  proj: string;
  /** For the Log km dialog. */
  odometer: number | null;
  odometerDate: ISODate | null;
}

export function kmRows(F: FleetData): KmRow[] {
  return F.vehicles
    .filter((v) => !["For sale", "Off the road"].includes(v.status || ""))
    .map((v) => {
      const p = kmPlan(v);
      const al = kmAlerts(F, v);
      const sev = worst(al);
      const parts: string[] = [];
      if (p.combined) parts.push("Service and bumper-to-bumper " + kmDueText(p.service));
      else {
        if (p.inspect) parts.push("Bumper-to-bumper " + kmDueText(p.inspect));
        if (p.service) parts.push("Service " + kmDueText(p.service));
      }
      if (!p.service) parts.push(p.inspect ? "last service km not captured" : "last service and bumper-to-bumper km not captured");
      const bk = al.find((a) => a.sev === "info");
      const next = p.combined || !p.inspect ? p.service : p.service && p.service.km < p.inspect.km ? p.service : p.inspect;
      const old = !!v.odometerDate && v.odometerDate < addDays(F.today, -30);
      const odo = has(v.odometer)
        ? "Odometer " + fmtKm(v.odometer) + (v.odometerDate ? " on " + fmtDate(v.odometerDate) + (old ? ` (${ago(v.odometerDate, F.today)}: log a new reading)` : "") : "")
        : "No odometer reading yet";
      return {
        id: v.id,
        name: v.name,
        reg: v.reg || null,
        sev: al.length ? (bk && sev === "ok" ? "info" : sev) : p.inspect ? "ok" : "none",
        text: parts.join(" · "),
        booked: bk?.booked || null,
        odo,
        proj: projText(v, next, F.today),
        odometer: has(v.odometer) ? Number(v.odometer) : null,
        odometerDate: v.odometerDate || null,
      };
    });
}

export const kmIntro = (): string =>
  `A bumper-to-bumper inspection at the workshop every ${fmtKm(KM_RULES.inspect)} and a service every ${fmtKm(KM_RULES.service)}. The service covers the inspection, so they’re booked as one visit. The Hub warns ${fmtKm(KM_RULES.warn)} before, using the latest odometer reading from inspections, workshop visits and km readings.`;

// ── Workshop bookings, trips and rentals ───────────────────

export interface ListRow {
  vehicleId: string;
  name: string;
  text: string;
  when: string;
  /** Dot: away now (info) or coming up (warn). */
  sev: "info" | "warn";
}

/** Booked workshop visits that haven't ended, soonest first. */
export function workshopRows(F: FleetData): ListRow[] {
  const vmap = vmapOf(F);
  return wsEvents(F)
    .filter((w) => w.to >= F.today && vmap[w.vehicleId])
    .map((w) => ({
      vehicleId: w.vehicleId,
      name: vmap[w.vehicleId].name,
      text: [w.kind, w.provider].filter(has).join(", "),
      when: fmtRange(w.from, w.to),
      sev: "warn" as const,
    }));
}

/** Trips and rentals (Hub bookings) that haven't ended, by start date. */
export function tripRows(F: FleetData): ListRow[] {
  const vmap = vmapOf(F);
  return F.trips
    .filter((t) => (t.to || "") >= F.today)
    .sort((a, b) => (a.from || "").localeCompare(b.from || ""))
    .map((t) => ({
      vehicleId: t.vehicleId,
      name: vmap[t.vehicleId]?.name || "Removed vehicle",
      text: tripName(t),
      when: `${fmtDay(t.from)} – ${fmtDay(t.to)}`,
      sev: t.from <= F.today ? ("info" as const) : ("warn" as const),
    }));
}

// ── Inspection days (schedSettingsHTML, saveSchedule) ──────

export interface ScheduleForm {
  days: number[];
  max: number;
  budgetHours: number;
  /** vehicle id → weekday (1–7), or null for "Not scheduled". */
  assign: Record<string, number | null>;
}

export function scheduleForm(F: FleetData): ScheduleForm & { saved: boolean } {
  const sc = schedule(F);
  return {
    days: sc.days,
    max: sc.max,
    budgetHours: Number((F.schedule && F.schedule.budgetHours) || 5),
    assign: Object.fromEntries(F.vehicles.map((v) => [v.id, Number(sc.assign[v.id]) || null])),
    saved: sc.saved,
  };
}

/** The app's refusals, in the order it checks them; null when the schedule can be saved. */
export function scheduleError(f: ScheduleForm): string | null {
  if (!f.days.length) return "Tick at least one inspection day.";
  const set = Object.values(f.assign).filter((d): d is number => !!d);
  const bad = set.find((d) => !f.days.includes(d));
  if (bad) return `${DAYS_LONG[bad - 1]} isn’t one of the inspection days. Tick it, or move that vehicle to another day.`;
  const load: Record<number, number> = {};
  set.forEach((d) => (load[d] = (load[d] || 0) + 1));
  const over = Object.keys(load)
    .map(Number)
    .find((d) => load[d] > f.max);
  if (over) return `${DAYS_LONG[over - 1]} has ${load[over]} vehicles; the most per day is ${f.max}.`;
  return null;
}

/** Vehicles per inspection day, for the line under each day ("2 of 2"). */
export function dayLoads(f: ScheduleForm): Record<number, number> {
  const load: Record<number, number> = {};
  for (const d of Object.values(f.assign)) if (d) load[d] = (load[d] || 0) + 1;
  return load;
}

/** The vehicles whose check day changes when the form is saved (each lives on the vehicle). */
export function changedDays(stored: Record<string, number | null>, f: ScheduleForm): { id: string; day: number | null }[] {
  return Object.entries(f.assign)
    .filter(([id, d]) => (stored[id] ?? null) !== (d ?? null))
    .map(([id, day]) => ({ id, day: day ?? null }));
}

/** The settings route's body for the schedule (the check days go to each vehicle). */
export const settingsBody = (f: ScheduleForm) => ({ days: [...f.days].sort((a, b) => a - b), maxPerDay: f.max, budgetHours: f.budgetHours });

/** Time this week against the budget, and the app's over-budget note. */
export function budgetLine(F: FleetData): { text: string; over: string | null } {
  const t = timeWeek(F);
  return {
    text: `This week so far: ${fmtMins(t.total)} of ${fmtMins(t.budget)}.`,
    over: t.over
      ? "Over the budget: on the Checklist page, move slow-changing points to once a month, or spread the checks over more days."
      : null,
  };
}

// ── Co-ordinator and reminders (notifyHTML) ────────────────

/** The reminder switches. The app stored an email address; the Hub stores on/off and sends to the role holder. */
export function notifyState(F: FleetData): { email: boolean; slack: boolean } {
  const n = (F.notify || {}) as { email?: unknown; slack?: unknown };
  return { email: !!n.email, slack: !!n.slack };
}

export const NO_COORDINATOR =
  "No one has the Vehicle Coordinator role yet: ask an admin to give it to someone in Users & Roles.";
