/**
 * The team lead's planner: how much of a budget category (mostly Food and
 * Accommodation) the team will spend each day, against the money that's
 * actually available in that category.
 *
 *   available   = category budget − spent so far in it
 *   committed   = what's still planned from today on: the unspent part of
 *                 today's plan + every future day's plan
 *   still to plan = available − committed     (red when negative)
 *
 * Past days are history (planned vs spent); planning is about today on.
 * A day that goes as planned leaves "still to plan" unchanged; overspending
 * on a day takes real money away from it.
 */

export function shiftDate(iso: string, days: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = shiftDate(d, 1)) out.push(d);
  return out;
}

export function mondayOf(date: string): string {
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((dow + 6) % 7));
}

export type DayPlanRow = { plan_date: string; amount_zar: number | string; note?: string | null };
export type SpendRow = { expense_date: string; zar_amount: number | string };

export type PlannerDay = {
  date: string;
  planned: number;
  note: string;
  spent: number;
};

export type PlannerWeek = { start: string; end: string; planned: number; spent: number; days: PlannerDay[] };

/** Days to show: the trip, stretched to cover any plan or spend outside it. */
export function plannerDays(args: {
  tripStart: string | null;
  tripEnd: string | null;
  plans: DayPlanRow[];
  spends: SpendRow[];
}): PlannerDay[] {
  const dates = [
    ...(args.tripStart ? [args.tripStart] : []),
    ...(args.tripEnd ? [args.tripEnd] : []),
    ...args.plans.map((p) => p.plan_date),
    ...args.spends.map((s) => s.expense_date),
  ].sort();
  if (dates.length === 0) return [];
  const plan = new Map(args.plans.map((p) => [p.plan_date, p]));
  const spent = new Map<string, number>();
  for (const s of args.spends) spent.set(s.expense_date, (spent.get(s.expense_date) ?? 0) + Number(s.zar_amount));
  return daysBetween(dates[0], dates[dates.length - 1]).map((date) => ({
    date,
    planned: round(Number(plan.get(date)?.amount_zar ?? 0)),
    note: plan.get(date)?.note ?? "",
    spent: round(spent.get(date) ?? 0),
  }));
}

export function plannerWeeks(days: PlannerDay[]): PlannerWeek[] {
  const weeks: PlannerWeek[] = [];
  for (const d of days) {
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
  return weeks;
}

/** The pot for one category, as of `today`. */
export function pot(args: { budget: number; days: PlannerDay[]; today: string }) {
  const spent = round(args.days.reduce((s, d) => s + d.spent, 0));
  const available = round(args.budget - spent);
  const committed = round(
    args.days.reduce((s, d) => {
      if (d.date > args.today) return s + d.planned;
      if (d.date === args.today) return s + Math.max(0, d.planned - d.spent);
      return s;
    }, 0)
  );
  const planned = round(args.days.reduce((s, d) => s + d.planned, 0));
  return { budget: round(args.budget), spent, available, committed, planned, stillToPlan: round(available - committed) };
}

/**
 * Share `amount` over `dates` in whole R10s, earlier days getting any
 * extra R10. What can't be split into R10s (under R10 a day) is left over.
 */
export function spreadEvenly(amount: number, dates: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (dates.length === 0 || amount <= 0) return out;
  const tens = Math.floor(amount / 10);
  const base = Math.floor(tens / dates.length);
  const extra = tens - base * dates.length;
  dates.forEach((d, i) => out.set(d, (base + (i < extra ? 1 : 0)) * 10));
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
