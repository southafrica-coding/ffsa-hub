/**
 * The outreach budget as a day-by-day and week-by-week plan.
 *
 * Every budget line says when its money goes out (migration 249):
 *   trip  — spread evenly across the team's trip dates
 *   range — spread evenly across its own dates
 *   day   — all on one date
 * Summing those per day gives the plan; expenses by expense_date give
 * what actually happened. Weeks run Monday–Sunday.
 */

export function shiftDate(iso: string, days: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export type PlanKind = "trip" | "range" | "day";

export type PlanLine = {
  id: string;
  description: string;
  category_id: string;
  total: number; // already amount × frequency × people at the current team size
  plan_kind?: PlanKind | null;
  plan_start?: string | null;
  plan_end?: string | null;
};

export type PlanExpense = {
  id?: string;
  expense_date: string;
  zar_amount: number | string;
  category_id: string;
  vendor?: string | null;
  description?: string | null;
};

export type DayPlan = {
  date: string;
  planned: number;
  spent: number;
  items: { lineId: string; description: string; category_id: string; amount: number }[];
  expenses: PlanExpense[];
};

export type WeekPlan = { start: string; end: string; planned: number; spent: number; days: DayPlan[] };

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/** The dates a line's money falls on, or null when it can't be placed. */
export function lineDates(line: PlanLine, trip: { start: string | null; end: string | null }): string[] | null {
  const kind = line.plan_kind ?? "trip";
  if (kind === "day" && line.plan_start) return [line.plan_start];
  if (kind === "range" && line.plan_start && line.plan_end && line.plan_end >= line.plan_start) {
    return daysBetween(line.plan_start, line.plan_end);
  }
  if (kind === "trip" && trip.start && trip.end && trip.end >= trip.start) return daysBetween(trip.start, trip.end);
  return null;
}

/** Split a total over n days in cents, so the days add back up exactly. */
export function splitEvenly(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

export function buildPlan(args: {
  lines: PlanLine[];
  expenses: PlanExpense[];
  trip: { start: string | null; end: string | null };
}) {
  const days = new Map<string, DayPlan>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, planned: 0, spent: 0, items: [], expenses: [] };
      days.set(date, d);
    }
    return d;
  };

  const unplaced: PlanLine[] = [];
  for (const line of args.lines) {
    if (!line.total) continue;
    const dates = lineDates(line, args.trip);
    if (!dates || dates.length === 0) {
      unplaced.push(line);
      continue;
    }
    splitEvenly(line.total, dates.length).forEach((amount, i) => {
      const d = day(dates[i]);
      d.planned += amount;
      d.items.push({ lineId: line.id, description: line.description, category_id: line.category_id, amount });
    });
  }
  for (const e of args.expenses) {
    const d = day(e.expense_date);
    d.spent += Number(e.zar_amount);
    d.expenses.push(e);
  }

  // Every day from the first to the last thing on the plan, gaps included.
  const keys = [...days.keys()].sort();
  const all: DayPlan[] = keys.length ? daysBetween(keys[0], keys[keys.length - 1]).map(day) : [];
  for (const d of all) {
    d.planned = round(d.planned);
    d.spent = round(d.spent);
  }

  const weeks: WeekPlan[] = [];
  for (const d of all) {
    const start = mondayOf(d.date);
    let w = weeks[weeks.length - 1];
    if (!w || w.start !== start) {
      w = { start, end: shiftDate(start, 6), planned: 0, spent: 0, days: [] };
      weeks.push(w);
    }
    w.days.push(d);
    w.planned = round(w.planned + d.planned);
    w.spent = round(w.spent + d.spent);
  }

  return { days: all, weeks, unplaced };
}

export function mondayOf(date: string): string {
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((dow + 6) % 7));
}

/** Planned vs spent for one day, one week (Mon–Sun) — e.g. "today", for the bot. */
export function periodSummary(plan: ReturnType<typeof buildPlan>, from: string, to: string) {
  const inRange = plan.days.filter((d) => d.date >= from && d.date <= to);
  const planned = round(inRange.reduce((s, d) => s + d.planned, 0));
  const spent = round(inRange.reduce((s, d) => s + d.spent, 0));
  return { from, to, planned, spent, left: round(planned - spent), days: inRange };
}

const round = (n: number) => Math.round(n * 100) / 100;
