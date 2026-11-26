"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Eraser, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lineTotal } from "@/lib/finance/outreach-budget";
import {
  plannerDays,
  plannerWeeks,
  pot,
  spreadEvenly,
  type PlannerDay,
} from "@/lib/finance/outreach-plan";
import { sastDate } from "@/lib/slack/assistant/outreach";
import type { BudgetLine } from "./budget-lines";

type Category = { id: string; name: string };
type DayPlan = { category_id: string; plan_date: string; amount_zar: number | string; note: string | null };
type Spend = { expense_date: string; zar_amount: number | string; category_id: string };
type Entry = { amount: string; note: string };

const zar = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);
const dayName = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });

// The two things teams actually plan day to day; others on request.
const MAIN = ["food", "accommodation"];
const isMain = (c: Category) => MAIN.includes(c.name.trim().toLowerCase());

/**
 * The team lead's planner: for Food (and Accommodation, or any category),
 * how much of the money available they'll spend each day — typed straight
 * into the day, with quick-fills — against what was actually spent.
 * Maths in lib/finance/outreach-plan.ts.
 */
export function Planner({
  teamId,
  tripStart,
  tripEnd,
  teamSize,
  lines,
  expenses,
  categories,
  dayPlans,
  canEdit,
}: {
  teamId: string;
  tripStart: string | null;
  tripEnd: string | null;
  teamSize: number;
  lines: BudgetLine[];
  expenses: Spend[];
  categories: Category[];
  dayPlans: DayPlan[];
  canEdit: boolean;
}) {
  const today = sastDate(new Date());

  // Food & Accommodation always; anything else once it has a plan or is picked.
  const main = categories.filter(isMain).sort((a, b) => MAIN.indexOf(a.name.toLowerCase()) - MAIN.indexOf(b.name.toLowerCase()));
  const planned = new Set(dayPlans.map((p) => p.category_id));
  const [extra, setExtra] = useState<string[]>(
    categories.filter((c) => !isMain(c) && planned.has(c.id)).map((c) => c.id)
  );
  const shown = [...main, ...categories.filter((c) => extra.includes(c.id) && !isMain(c))];
  const inBudget = new Set(lines.map((l) => l.category_id));
  const addable = categories
    .filter((c) => !shown.some((s) => s.id === c.id) && inBudget.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [catId, setCatId] = useState(shown[0]?.id ?? "");

  // Local copy of every category's plan, edited in place and saved per day.
  const [entries, setEntries] = useState<Record<string, Record<string, Entry>>>(() => {
    const out: Record<string, Record<string, Entry>> = {};
    for (const p of dayPlans) {
      (out[p.category_id] ??= {})[p.plan_date] = {
        amount: Number(p.amount_zar) ? String(Number(p.amount_zar)) : "",
        note: p.note ?? "",
      };
    }
    return out;
  });
  const [saving, setSaving] = useState(0);

  const catEntries = entries[catId] ?? {};
  const budget = useMemo(
    () => lines.filter((l) => l.category_id === catId).reduce((s, l) => s + lineTotal(l, teamSize), 0),
    [lines, catId, teamSize]
  );
  const days: PlannerDay[] = plannerDays({
    tripStart,
    tripEnd,
    plans: Object.entries(catEntries).map(([plan_date, e]) => ({ plan_date, amount_zar: Number(e.amount) || 0, note: e.note })),
    spends: expenses.filter((e) => e.category_id === catId),
  });
  const weeks = plannerWeeks(days);
  const p = pot({ budget, days, today });
  const cat = categories.find((c) => c.id === catId);

  async function save(changes: Record<string, Entry>) {
    if (!canEdit) return;
    setSaving((n) => n + 1);
    try {
      const res = await fetch("/api/finance/outreach/day-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          category_id: catId,
          days: Object.entries(changes).map(([plan_date, e]) => ({
            plan_date,
            amount_zar: Number(e.amount) || 0,
            note: e.note,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Couldn't save the plan");
      }
    } catch {
      toast.error("Network error — the plan wasn't saved");
    } finally {
      setSaving((n) => n - 1);
    }
  }

  const setDay = (date: string, patch: Partial<Entry>) =>
    setEntries((prev) => {
      const cur = prev[catId]?.[date] ?? { amount: "", note: "" };
      return { ...prev, [catId]: { ...prev[catId], [date]: { ...cur, ...patch } } };
    });

  /** Apply several days at once (quick-fills) and save them together. */
  function applyMany(changes: Record<string, Entry>) {
    setEntries((prev) => ({ ...prev, [catId]: { ...prev[catId], ...changes } }));
    save(changes);
  }

  function spreadRest() {
    const empty = days.filter((d) => d.date >= today && !(Number(catEntries[d.date]?.amount) > 0)).map((d) => d.date);
    if (p.stillToPlan < 10) return toast.message("There's nothing left to plan.");
    if (!empty.length) return toast.message("Every day from today is already planned.");
    const split = spreadEvenly(p.stillToPlan, empty);
    const changes: Record<string, Entry> = {};
    for (const [date, amount] of split) changes[date] = { amount: String(amount), note: catEntries[date]?.note ?? "" };
    applyMany(changes);
    toast.success(`Spread ${zar([...split.values()].reduce((a, b) => a + b, 0))} over ${empty.length} days`);
  }

  function copyToRestOfWeek(date: string, weekDays: PlannerDay[]) {
    const src = catEntries[date] ?? { amount: "", note: "" };
    const changes: Record<string, Entry> = {};
    for (const d of weekDays) if (d.date > date) changes[d.date] = { amount: src.amount, note: catEntries[d.date]?.note ?? "" };
    if (!Object.keys(changes).length) return;
    applyMany(changes);
  }

  function clearWeek(weekDays: PlannerDay[]) {
    const changes: Record<string, Entry> = {};
    for (const d of weekDays) if (d.date >= today) changes[d.date] = { amount: "", note: "" };
    if (!Object.keys(changes).length) return toast.message("Only past days in this week — nothing to clear.");
    applyMany(changes);
  }

  if (!tripStart || !tripEnd) {
    return (
      <div className="border border-dashed border-rule-strong px-6 py-10 text-center">
        <p className="font-medium">No trip dates yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Set the team&apos;s start and end dates to plan day by day.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* What are we planning? */}
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatId(c.id)}
            className={`border px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] ${
              c.id === catId ? "border-ink bg-ink text-white" : "border-rule-strong hover:border-ink"
            }`}
          >
            {c.name}
          </button>
        ))}
        {addable.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => {
              setExtra((x) => [...x, v]);
              setCatId(v);
            }}
          >
            <SelectTrigger className="h-9 w-auto border-dashed font-mono text-[11px] uppercase tracking-[0.1em]">
              <SelectValue placeholder="+ Plan another category" />
            </SelectTrigger>
            <SelectContent>
              {addable.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto font-mono text-[11px] text-[color:var(--text-tertiary)]">{saving > 0 ? "Saving…" : canEdit ? "Saved" : "View only"}</span>
      </div>

      {/* The pot */}
      <div className="border border-ink bg-bone px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <div className="mono-label mb-1">{cat?.name ?? "Category"} — available</div>
            <span className="numeral text-[30px] leading-none">{zar(p.available)}</span>
            <div className="mt-1.5 font-mono text-[11px] text-[color:var(--text-muted)]">
              budget {zar(p.budget)} · spent so far {zar(p.spent)}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="mono-label mb-1">Still to plan</div>
            <span
              className="numeral text-[30px] leading-none"
              style={{ color: p.stillToPlan < 0 ? "hsl(var(--destructive))" : p.stillToPlan < 10 ? "var(--green-text)" : undefined }}
            >
              {p.stillToPlan < 0 ? `−${zar(-p.stillToPlan)}` : zar(p.stillToPlan)}
            </span>
            <div className="mt-1.5 font-mono text-[11px] text-[color:var(--text-muted)]">
              {p.stillToPlan < 0
                ? "planned more than is available — trim some days"
                : `planned from today on: ${zar(p.committed)}`}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={spreadRest} disabled={p.stillToPlan < 10}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Spread evenly over empty days
            </Button>
          </div>
        )}
        {budget === 0 && (
          <p className="mt-2 text-sm text-amber">
            There&apos;s no {cat?.name.toLowerCase() ?? "budget"} money in the budget yet — add it on the Budget tab.
          </p>
        )}
      </div>

      {/* The days */}
      <div className="space-y-3">
        {weeks.map((w, i) => (
          <section key={w.start} className="border border-ink">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-bone px-4 py-2.5">
              <span className="font-medium">
                Week {i + 1}
                <span className="ml-2 font-mono text-[11px] font-normal text-[color:var(--text-tertiary)]">
                  {shortDay(w.start)} – {shortDay(w.end)}
                </span>
              </span>
              <span className="flex items-center gap-4 font-mono text-[12px] tabular-nums">
                <span>
                  <span className="text-[color:var(--text-tertiary)]">Planned </span>
                  {zar(w.planned)}
                </span>
                <span>
                  <span className="text-[color:var(--text-tertiary)]">Spent </span>
                  {zar(w.spent)}
                </span>
                {canEdit && w.end >= today && (
                  <button
                    type="button"
                    onClick={() => clearWeek(w.days)}
                    className="flex items-center gap-1 text-[color:var(--text-tertiary)] hover:text-destructive"
                    title="Clear this week's plan from today on"
                  >
                    <Eraser className="h-3.5 w-3.5" /> Clear
                  </button>
                )}
              </span>
            </header>

            {w.days.map((d) => {
              const e = catEntries[d.date] ?? { amount: "", note: "" };
              const past = d.date < today;
              const isToday = d.date === today;
              const diff = d.planned - d.spent;
              const outside = (tripStart && d.date < tripStart) || (tripEnd && d.date > tripEnd);
              return (
                <div
                  key={d.date}
                  className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 border-t border-rule px-4 py-2 sm:grid-cols-[120px_120px_1fr_210px_28px] ${
                    isToday ? "bg-[var(--surface-hover)]" : ""
                  } ${outside ? "opacity-60" : ""}`}
                >
                  <div className={`text-sm ${isToday ? "font-medium" : past ? "text-[color:var(--text-tertiary)]" : ""}`}>
                    {dayName(d.date)}
                    {isToday && <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.1em]">today</span>}
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[color:var(--text-tertiary)]">R</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={10}
                      disabled={!canEdit}
                      aria-label={`Plan for ${dayName(d.date)}`}
                      value={e.amount}
                      placeholder="0"
                      onChange={(ev) => setDay(d.date, { amount: ev.target.value })}
                      onBlur={() => save({ [d.date]: catEntries[d.date] ?? { amount: "", note: "" } })}
                      className="h-8 pl-6 text-right font-mono"
                    />
                  </div>
                  <Input
                    disabled={!canEdit}
                    aria-label={`Note for ${dayName(d.date)}`}
                    value={e.note}
                    placeholder={isMainNotePlaceholder(cat?.name)}
                    onChange={(ev) => setDay(d.date, { note: ev.target.value })}
                    onBlur={() => save({ [d.date]: catEntries[d.date] ?? { amount: "", note: "" } })}
                    className="col-span-2 h-8 border-transparent bg-transparent px-1 text-sm shadow-none hover:border-rule focus:border-rule-strong sm:col-span-1"
                  />
                  <div className="col-span-2 whitespace-nowrap font-mono text-[12px] tabular-nums sm:col-span-1 sm:text-right">
                    {d.spent > 0 ? (
                      <>
                        <span className="text-[color:var(--text-tertiary)]">spent </span>
                        {zar(d.spent)}
                        {d.planned > 0 && (past || isToday) && (
                          <span
                            className="ml-2"
                            style={{ color: diff < 0 ? "hsl(var(--destructive))" : past ? "var(--green-text)" : undefined }}
                          >
                            {diff < 0 ? `${zar(-diff)} over` : past ? `${zar(diff)} under` : `${zar(diff)} left`}
                          </span>
                        )}
                      </>
                    ) : past ? (
                      <span className="text-[color:var(--text-quiet)]">nothing spent</span>
                    ) : null}
                  </div>
                  <div className="hidden sm:block">
                    {canEdit && !past && e.amount && (
                      <button
                        type="button"
                        onClick={() => copyToRestOfWeek(d.date, w.days)}
                        className="text-[color:var(--text-quiet)] hover:text-ink"
                        title="Same amount for the rest of this week"
                        aria-label={`Same amount for the rest of the week after ${dayName(d.date)}`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function isMainNotePlaceholder(name?: string) {
  const n = (name ?? "").toLowerCase();
  if (n === "accommodation") return "e.g. guesthouse, 3 nights";
  if (n === "food") return "e.g. market day, cook at the house";
  return "note";
}
