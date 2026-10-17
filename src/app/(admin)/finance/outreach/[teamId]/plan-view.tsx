import { Bar } from "@/components/ffsa";
import { lineTotal } from "@/lib/finance/outreach-budget";
import { buildPlan, mondayOf, periodSummary, shiftDate, type PlanExpense } from "@/lib/finance/outreach-plan";
import { sastDate } from "@/lib/slack/assistant/outreach";
import type { BudgetLine } from "./budget-lines";

const zar = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);
const dayName = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });

const OVER = "hsl(var(--destructive))";
const UNDER = "var(--green-text)";

/**
 * Spent against planned. A finished period is "under"/"over"; one still
 * running has money "left"; one that hasn't started is just "to come".
 */
function Diff({ planned, spent, from, to, today }: { planned: number; spent: number; from: string; to: string; today: string }) {
  const d = Math.round(planned - spent);
  if (planned === 0 && spent === 0) return <span className="text-[#7C786C]">—</span>;
  if (from > today && spent === 0) return <span className="text-[#7C786C]">to come</span>;
  if (to >= today && d > 0) return <span>{zar(d)} left</span>;
  if (Math.abs(d) < 1) return <span className="text-[#7C786C]">on plan</span>;
  return d > 0 ? <span style={{ color: UNDER }}>{zar(d)} under</span> : <span style={{ color: OVER }}>{zar(-d)} over</span>;
}

function Summary({
  title,
  sub,
  planned,
  spent,
  from,
  to,
  today,
}: {
  title: string;
  sub: string;
  planned: number;
  spent: number;
  from: string;
  to: string;
  today: string;
}) {
  const pct = planned > 0 ? (spent / planned) * 100 : spent > 0 ? 101 : 0;
  return (
    <div className="border border-ink px-4 py-3">
      <div className="mono-label">{title}</div>
      <div className="mt-0.5 font-mono text-[11px] text-[#7C786C]">{sub}</div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="numeral text-[24px] leading-none">{zar(planned)}</span>
        <span className="font-mono text-[12px]">
          <span className="text-[#7C786C]">spent </span>
          {zar(spent)}
        </span>
      </div>
      <div className="mt-2">
        <Bar pct={pct} tone={pct > 100 ? OVER : undefined} />
      </div>
      <div className="mt-1.5 font-mono text-[11px]">
        <Diff planned={planned} spent={spent} from={from} to={to} today={today} />
      </div>
    </div>
  );
}

/**
 * The budget as a plan for every day and week of the outreach, against
 * what was actually spent. Built from each budget line's "When" (whole
 * trip / certain dates / one day) — see lib/finance/outreach-plan.ts.
 */
export function PlanView({
  lines,
  teamSize,
  tripStart,
  tripEnd,
  expenses,
  categories,
}: {
  lines: BudgetLine[];
  teamSize: number;
  tripStart: string | null;
  tripEnd: string | null;
  expenses: PlanExpense[];
  categories: { id: string; name: string }[];
}) {
  const plan = buildPlan({
    trip: { start: tripStart, end: tripEnd },
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      category_id: l.category_id,
      total: lineTotal(l, teamSize),
      plan_kind: l.plan_kind ?? "trip",
      plan_start: l.plan_start,
      plan_end: l.plan_end,
    })),
    expenses,
  });
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const today = sastDate(new Date());
  const week = periodSummary(plan, mondayOf(today), shiftDate(mondayOf(today), 6));
  const todays = periodSummary(plan, today, today);
  const whole = periodSummary(plan, "0000-01-01", "9999-12-31");
  const thisWeekStart = mondayOf(today);

  if (plan.days.length === 0) {
    return (
      <div className="border border-dashed border-rule-strong px-6 py-10 text-center">
        <p className="font-medium">No plan yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {!tripStart || !tripEnd
            ? "This team has no trip dates, so the budget can't be spread over days. Set the team's start and end dates."
            : "Add budget lines on the Budget tab — each one becomes part of the day-by-day plan."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        The budget spread over the outreach, day by day. Change when a line is spent on the <strong>Budget</strong> tab
        (✏️ on the line → <em>When is it spent?</em>).
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary title="Today" sub={dayName(today)} planned={todays.planned} spent={todays.spent} from={today} to={today} today={today} />
        <Summary
          title="This week"
          sub={`${shortDay(week.from)} – ${shortDay(week.to)}`}
          planned={week.planned}
          spent={week.spent}
          from={week.from}
          to={week.to}
          today={today}
        />
        <Summary
          title="Whole plan"
          sub={`${shortDay(plan.days[0].date)} – ${shortDay(plan.days[plan.days.length - 1].date)}`}
          planned={whole.planned}
          spent={whole.spent}
          from={plan.days[0].date}
          to={plan.days[plan.days.length - 1].date}
          today={today}
        />
      </div>

      {plan.unplaced.length > 0 && (
        <p className="border border-amber-border bg-[#FFF8E6] px-3 py-2 text-sm">
          {plan.unplaced.length} {plan.unplaced.length === 1 ? "line isn't" : "lines aren't"} in the plan because the team
          has no trip dates: {plan.unplaced.map((l) => l.description).join(", ")}.
        </p>
      )}

      <div className="space-y-3">
        {plan.weeks.map((w, i) => {
          const current = w.start === thisWeekStart;
          return (
            <details key={w.start} open={current} className="group border border-ink">
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-bone px-4 py-3">
                <span className="font-medium">
                  Week {i + 1}
                  <span className="ml-2 font-mono text-[11px] font-normal text-[#7C786C]">
                    {shortDay(w.start)} – {shortDay(w.end)}
                    {current ? " · this week" : ""}
                  </span>
                </span>
                <span className="flex gap-4 font-mono text-[12px] tabular-nums">
                  <span>
                    <span className="text-[#7C786C]">Planned </span>
                    {zar(w.planned)}
                  </span>
                  <span>
                    <span className="text-[#7C786C]">Spent </span>
                    {zar(w.spent)}
                  </span>
                  <Diff planned={w.planned} spent={w.spent} from={w.start} to={w.end} today={today} />
                </span>
              </summary>

              <div>
                {w.days.map((d) => {
                  const isToday = d.date === today;
                  const empty = d.planned === 0 && d.spent === 0;
                  return (
                    <details key={d.date} className="border-t border-rule">
                      <summary
                        className={`flex cursor-pointer list-none items-baseline justify-between gap-3 px-4 py-2 text-sm ${
                          isToday ? "bg-[#FBFAF6] font-medium" : ""
                        } ${empty ? "text-[#9A968B]" : ""}`}
                      >
                        <span>
                          {dayName(d.date)}
                          {isToday && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em]">today</span>}
                        </span>
                        <span className="flex gap-4 font-mono text-[12px] tabular-nums">
                          <span>{zar(d.planned)}</span>
                          <span className="text-[#7C786C]">spent {zar(d.spent)}</span>
                          <span className="min-w-[90px] text-right">
                            <Diff planned={d.planned} spent={d.spent} from={d.date} to={d.date} today={today} />
                          </span>
                        </span>
                      </summary>
                      {!empty && (
                        <div className="grid gap-4 px-4 pb-3 pt-1 sm:grid-cols-2">
                          <div>
                            <div className="mono-label mb-1">Planned</div>
                            {d.items.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Nothing planned.</p>
                            ) : (
                              <ul className="space-y-0.5 text-xs">
                                {d.items.map((it) => (
                                  <li key={it.lineId} className="flex justify-between gap-2">
                                    <span>
                                      {it.description}
                                      <span className="text-[#7C786C]"> · {cat.get(it.category_id) ?? ""}</span>
                                    </span>
                                    <span className="font-mono tabular-nums">{zar(it.amount)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="mono-label mb-1">Spent</div>
                            {d.expenses.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No receipts.</p>
                            ) : (
                              <ul className="space-y-0.5 text-xs">
                                {d.expenses.map((e, j) => (
                                  <li key={e.id ?? j} className="flex justify-between gap-2">
                                    <span>
                                      {e.vendor || e.description || "Expense"}
                                      <span className="text-[#7C786C]"> · {cat.get(e.category_id) ?? ""}</span>
                                    </span>
                                    <span className="font-mono tabular-nums">{zar(Number(e.zar_amount))}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
