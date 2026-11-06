"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bar, KpiStrip, Masthead, MastheadButton, ModuleTabs, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { MoneyKpi } from "../money-kpi";
import type { BudgetLineKind } from "@/lib/finance/budget-lines";
import type { BudgetScopeOptions } from "@/lib/finance/budget-scope";
import {
  TEAM_BUDGET_SECTIONS,
  TEAM_BUDGET_TEMPLATE_NAME,
  OWNER_KIND_LABEL,
  PERIOD_KIND_LABEL,
  PERIOD_KINDS,
  BUDGET_OWNER_KINDS,
  draftIsDirty,
  emptyBudgetDraft,
  formatBudgetMoney,
  needsYouCopy,
  newSheetLine,
  parseDriver,
  parseOptionalMoney,
  periodProblem,
  rollup,
  scopeGaps,
  type BudgetOwnerKind,
  type BudgetSectionKey,
  type BudgetSheetDraft,
  type PeriodKind,
  type SheetLine,
} from "@/lib/finance/budget-sheet";
import { BudgetActuals } from "./budget-actuals";
import { CostGrid } from "./cost-grid";

const control =
  "mt-1.5 h-11 w-full border border-ink bg-white px-2 text-sm text-ink outline-none focus:bg-bone";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function BudgetSheet({
  options,
  budgetId = null,
  canReadXero = false,
  invalidBudgetId = false,
  initialSection = "overview",
}: {
  options: BudgetScopeOptions;
  /** Set on /finance/budgets/[id]. The empty sheet has no saved budget. */
  budgetId?: string | null;
  canReadXero?: boolean;
  /** The URL had an id that isn't a budget id. Xero is not asked. */
  invalidBudgetId?: boolean;
  initialSection?: BudgetSectionKey;
}) {
  const [draft, setDraft] = useState<BudgetSheetDraft>(emptyBudgetDraft);
  const [section, setSection] = useState<BudgetSectionKey>(initialSection);

  const driverValue = parseDriver(draft.driverValue);
  const variable = useMemo(() => rollup(draft.lines, "variable", driverValue), [draft.lines, driverValue]);
  const fixed = useMemo(() => rollup(draft.lines, "fixed", driverValue), [draft.lines, driverValue]);
  const totalCents = variable.cents + fixed.cents;
  const gaps = scopeGaps(draft);
  const org = options.orgs.find((item) => item.id === draft.orgId) ?? null;
  const currency = org?.currency ?? null;
  const owners = draft.ownerKind ? options.owners[draft.ownerKind] : [];
  const owner = owners.find((item) => item.id === draft.ownerId) ?? null;
  const periodIssue = periodProblem(draft);
  const active = TEAM_BUDGET_SECTIONS.find((item) => item.key === section) ?? TEAM_BUDGET_SECTIONS[0];

  function patch(partial: Partial<BudgetSheetDraft>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function updateLine(id: string, linePatch: Partial<SheetLine>) {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.id === id ? { ...line, ...linePatch } : line)),
    }));
  }

  function addLine(kind: BudgetLineKind) {
    setDraft((prev) => ({ ...prev, lines: [...prev.lines, newSheetLine(kind, newId())] }));
  }

  function removeLine(id: string) {
    setDraft((prev) => ({ ...prev, lines: prev.lines.filter((line) => line.id !== id) }));
  }

  function clearSheet() {
    if (draftIsDirty(draft) && !window.confirm("Clear this sheet? It is not saved anywhere else.")) return;
    setDraft(emptyBudgetDraft());
    setSection("overview");
  }

  const money = (cents: number) => formatBudgetMoney(cents, currency);

  return (
    <div data-testid="budget-sheet" className="max-w-full overflow-x-clip">
      <Masthead
        context={draft.name.trim() ? `Finance · ${draft.name.trim()}` : `Finance · ${TEAM_BUDGET_TEMPLATE_NAME}`}
        title="Budget"
        actions={
          <>
            <StatusPill tone="warn">Not saved</StatusPill>
            <MastheadButton tone="outline" onClick={clearSheet}>
              Clear sheet
            </MastheadButton>
            <Link
              href="/finance"
              className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
            >
              &larr; Finance
            </Link>
          </>
        }
      />

      <NeedsYou>{needsYouCopy(gaps)}</NeedsYou>

      <div className="grid grid-cols-1 gap-px bg-ink sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Name">
          <input
            className={control}
            value={draft.name}
            placeholder="Name this budget"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Owner">
          <select
            className={control}
            aria-label="What this budget belongs to"
            value={draft.ownerKind}
            onChange={(e) => patch({ ownerKind: e.target.value as BudgetOwnerKind | "", ownerId: "" })}
          >
            <option value="">Choose one</option>
            {BUDGET_OWNER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {OWNER_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={draft.ownerKind ? OWNER_KIND_LABEL[draft.ownerKind] : "Which one"}>
          <select
            className={control}
            aria-label="Owner"
            value={draft.ownerId}
            disabled={!draft.ownerKind}
            onChange={(e) => patch({ ownerId: e.target.value })}
          >
            <option value="">{draft.ownerKind ? "Choose one" : "Choose a kind first"}</option>
            {owners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {draft.ownerKind && owners.length === 0 && (
            <p className="mt-1.5 text-[12px] text-amber">Nothing you can see for this kind.</p>
          )}
        </Field>
        <Field label="Organisation">
          <select
            className={control}
            aria-label="Organisation"
            value={draft.orgId}
            disabled={!options.orgsReadable || options.orgs.length === 0}
            onChange={(e) => patch({ orgId: e.target.value })}
          >
            <option value="">Choose one</option>
            {options.orgs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.inactive ? " (inactive)" : ""}
                {item.currency ? ` · ${item.currency}` : ""}
              </option>
            ))}
          </select>
          {!options.orgsReadable && (
            <p className="mt-1.5 text-[12px] text-amber">
              Finance organisations could not be read. A budget needs one.
            </p>
          )}
          {options.orgsReadable && options.orgs.length === 0 && (
            <p className="mt-1.5 text-[12px] text-amber">No finance organisations are on this Hub yet.</p>
          )}
        </Field>
        <div className="bg-white px-3 py-3">
          <div className="mono-label">Currency</div>
          <div className="numeral mt-2 text-[28px] leading-none">{currency ?? "—"}</div>
          <p className="mt-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">
            {org
              ? `Locked to ${org.name}. Amounts are not converted if you change organisation.`
              : "Set by the organisation. You don't pick a currency."}
          </p>
        </div>
        <Field label="Period">
          <select
            className={control}
            aria-label="Period kind"
            value={draft.periodKind}
            onChange={(e) => patch({ periodKind: e.target.value as PeriodKind | "" })}
          >
            <option value="">Year, term, or event</option>
            {PERIOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PERIOD_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period name">
          <input
            className={control}
            aria-label="Period name"
            value={draft.periodLabel}
            placeholder="2027"
            onChange={(e) => patch({ periodLabel: e.target.value })}
          />
        </Field>
        <Field label="Dates">
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Period start"
              className="h-11 w-full border border-ink bg-white px-2 text-sm outline-none focus:bg-bone"
              value={draft.periodStart}
              onChange={(e) => patch({ periodStart: e.target.value })}
            />
            <input
              type="date"
              aria-label="Period end"
              className="h-11 w-full border border-ink bg-white px-2 text-sm outline-none focus:bg-bone"
              value={draft.periodEnd}
              onChange={(e) => patch({ periodEnd: e.target.value })}
            />
          </div>
          {draft.periodKind && periodIssue && <p className="mt-1.5 text-[12px] text-amber">{periodIssue}</p>}
        </Field>
        <div className="bg-bone px-3 py-3 sm:col-span-2 xl:col-span-4">
          <div className="mono-label">Xero codes</div>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-snug text-ink">
            You edit amounts and notes. Finance maps each line to a Xero code for{" "}
            {org ? org.name : "the organisation"}. This sheet has no chart-of-accounts picker.
            {draft.lines.length > 0 && " Every line is not coded yet."}
          </p>
          {(owner || org || (draft.periodKind && !periodIssue)) && (
            <p className="mono-label mt-3">
              {[
                owner?.label,
                org?.name,
                currency,
                draft.periodKind && !periodIssue
                  ? `${draft.periodLabel.trim()} · ${draft.periodStart} – ${draft.periodEnd}`
                  : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          )}
        </div>
      </div>

      <ModuleTabs
        tabs={TEAM_BUDGET_SECTIONS.map((item) => ({ key: item.key, label: item.label }))}
        active={section}
        onChange={(key) => setSection(key as BudgetSectionKey)}
      />

      <div className="min-w-0 max-w-full px-5 py-6 md:px-8" data-section={section}>
        {section === "overview" && (
          <Overview draft={draft} driverValue={driverValue} onChange={patch} />
        )}
        {section === "dashboard" && (
          <div className="space-y-6">
            <Dashboard
              help={active.help}
              variable={variable}
              fixed={fixed}
              totalCents={totalCents}
              lineCount={draft.lines.length}
              currencyLabel={currency}
              money={money}
              driverLabel={draft.driverLabel}
              driverValue={driverValue}
              fundingGoal={draft.fundingGoal}
              fundsInHand={draft.fundsInHand}
            />
            <BudgetActuals budgetId={budgetId} canRead={canReadXero} invalidBudgetId={invalidBudgetId} />
          </div>
        )}
        {(section === "variable" || section === "fixed") && (
          <div className="border border-ink">
            <SectionBar
              title={active.label}
              meta={
                section === "variable"
                  ? `${lineCountLabel(variable.count)} · ${money(variable.cents)}`
                  : `${lineCountLabel(fixed.count)} · ${money(fixed.cents)}`
              }
            />
            <div className="flex flex-col gap-3 border-b border-rule bg-bone px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-[13px] leading-snug">{active.help}</p>
              <button
                type="button"
                onClick={() => addLine(section)}
                className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
              >
                Add a line
              </button>
            </div>
            <CostGrid
              kind={section}
              lines={draft.lines}
              currency={currency}
              driverLabel={draft.driverLabel}
              driverValue={driverValue}
              onChange={updateLine}
              onRemove={removeLine}
            />
          </div>
        )}
        {section === "expense_tracker" && <ExpenseTracker help={active.help} />}
        {section === "notes" && (
          <div className="border border-ink">
            <SectionBar title="Notes" />
            <p className="border-b border-rule px-4 py-3 text-[13px]">{active.help}</p>
            <textarea
              aria-label="Notes"
              className="min-h-[240px] w-full resize-y bg-white px-4 py-3 text-sm outline-none focus:bg-bone"
              value={draft.notes}
              placeholder="Anything else finance or the team should know."
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function lineCountLabel(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block bg-white px-3 py-3">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

function Overview({
  draft,
  driverValue,
  onChange,
}: {
  draft: BudgetSheetDraft;
  driverValue: number | null;
  onChange: (partial: Partial<BudgetSheetDraft>) => void;
}) {
  const help = TEAM_BUDGET_SECTIONS[0].help;
  return (
    <div className="border border-ink">
      <SectionBar title="Overview" meta={TEAM_BUDGET_TEMPLATE_NAME} />
      <p className="border-b border-rule px-4 py-3 text-[13px]">{help} The sheet starts empty. No lines are imported.</p>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
        <OverviewRow label="What this covers">
          <textarea
            aria-label="What this budget covers"
            className="min-h-[88px] w-full resize-y border border-ink bg-white px-2 py-2 text-sm outline-none focus:bg-bone"
            value={draft.purpose}
            placeholder="Who it is for, and what the money is meant to do."
            onChange={(e) => onChange({ purpose: e.target.value })}
          />
        </OverviewRow>
        <OverviewRow label="Driver">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              aria-label="Driver name"
              className={control}
              value={draft.driverLabel}
              placeholder="Volunteers"
              onChange={(e) => onChange({ driverLabel: e.target.value })}
            />
            <input
              aria-label="Driver count"
              inputMode="decimal"
              className={`${control} font-mono tabular-nums`}
              value={draft.driverValue}
              placeholder="How many"
              onChange={(e) => onChange({ driverValue: e.target.value })}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-[color:var(--text-secondary)]">
            {driverValue === null
              ? "Lines can follow this number instead of typing their own multiplier. It is blank, so those lines total zero."
              : `Lines that use the driver multiply by ${driverValue}. Change it here and their totals move.`}
          </p>
        </OverviewRow>
        <MoneyRow label="Funding goal" value={draft.fundingGoal} onChange={(fundingGoal) => onChange({ fundingGoal })} />
        <MoneyRow label="Funds in hand" value={draft.fundsInHand} onChange={(fundsInHand) => onChange({ fundsInHand })} />
        <MoneyRow label="Income goal" value={draft.incomeGoal} onChange={(incomeGoal) => onChange({ incomeGoal })} />
        <MoneyRow label="Fundraising goal" value={draft.fundraisingGoal} onChange={(fundraisingGoal) => onChange({ fundraisingGoal })} />
      </div>
    </div>
  );
}

function OverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="mono-label flex items-start border-b border-rule bg-bone px-4 py-3 md:items-center">{label}</div>
      <div className="border-b border-rule px-3 py-3">{children}</div>
    </>
  );
}

function MoneyRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseOptionalMoney(value);
  return (
    <OverviewRow label={label}>
      <input
        aria-label={label}
        inputMode="decimal"
        className={`${control} max-w-xs font-mono tabular-nums`}
        value={value}
        placeholder="Optional"
        onChange={(e) => onChange(e.target.value)}
      />
      {parsed.state === "invalid" && (
        <p className="mt-1.5 text-[12px] text-amber">Use a number, or leave it blank.</p>
      )}
    </OverviewRow>
  );
}

function Dashboard({
  help,
  variable,
  fixed,
  totalCents,
  lineCount,
  currencyLabel,
  money,
  driverLabel,
  driverValue,
  fundingGoal,
  fundsInHand,
}: {
  help: string;
  variable: ReturnType<typeof rollup>;
  fixed: ReturnType<typeof rollup>;
  totalCents: number;
  lineCount: number;
  currencyLabel: string | null;
  money: (cents: number) => string;
  driverLabel: string;
  driverValue: number | null;
  fundingGoal: string;
  fundsInHand: string;
}) {
  const goal = parseOptionalMoney(fundingGoal);
  const inHand = parseOptionalMoney(fundsInHand);
  const incomplete = variable.incomplete + fixed.incomplete;
  const perDriver =
    driverValue !== null && driverValue > 0 ? Math.round(totalCents / driverValue) : null;
  const goalPct =
    goal.state === "cents" && goal.cents > 0 ? Math.round((totalCents / goal.cents) * 100) : null;

  return (
    <div className="border border-ink">
      <SectionBar title="Dashboard" meta={currencyLabel ?? "No currency yet"} />
      <p className="border-b border-rule px-4 py-3 text-[13px]">{help}</p>
      <KpiStrip>
        <MoneyKpi
          label="Variable"
          value={money(variable.cents)}
          foot={variable.count === 0 ? "No lines" : `${variable.ready} of ${variable.count} ready`}
        />
        <MoneyKpi
          label="Fixed"
          value={money(fixed.cents)}
          foot={fixed.count === 0 ? "No lines" : `${fixed.ready} of ${fixed.count} ready`}
        />
        <MoneyKpi label="Total" value={money(totalCents)} foot={incomplete ? `${incomplete} still to finish` : "From ready lines"} lead />
        <MoneyKpi
          label="Not coded"
          value={String(lineCount)}
          foot={lineCount === 0 ? "No lines yet" : "Finance maps these"}
        />
      </KpiStrip>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink bg-bone">
            <th className="mono-label px-4 py-2 font-bold">Worked out</th>
            <th className="mono-label px-4 py-2 text-right font-bold">Amount</th>
          </tr>
        </thead>
        <tbody>
          <DashRow label="Variable cost" value={money(variable.cents)} />
          <DashRow label="Fixed cost" value={money(fixed.cents)} />
          <DashRow label="Whole budget" value={money(totalCents)} strong />
          {perDriver !== null && (
            <DashRow
              label={`Per ${driverLabel.trim() || "driver"}`}
              value={money(perDriver)}
            />
          )}
          {goal.state === "cents" && <DashRow label="Funding goal" value={money(goal.cents)} />}
          {inHand.state === "cents" && <DashRow label="Funds in hand" value={money(inHand.cents)} />}
          {inHand.state === "cents" && (
            <DashRow
              label={inHand.cents >= totalCents ? "Still in hand, against the plan" : "Plan is above funds in hand"}
              value={money(Math.abs(inHand.cents - totalCents))}
            />
          )}
        </tbody>
      </table>
      {goalPct !== null && (
        <div className="border-t border-rule px-4 py-4">
          <div className="mono-label mb-2">Plan against the funding goal · {goalPct}%</div>
          <Bar pct={goalPct} tone={goalPct > 100 ? "var(--amber-border)" : "#0A0A0A"} />
        </div>
      )}
      {lineCount === 0 && (
        <p className="border-t border-rule px-4 py-4 text-[13px] text-[color:var(--text-secondary)]">
          Add lines on Variable cost or Fixed cost. The totals land here.
        </p>
      )}
    </div>
  );
}

function DashRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className="border-b border-rule">
      <td className="px-4 py-3 text-sm">{label}</td>
      <td className={`px-4 py-3 text-right font-mono tabular-nums ${strong ? "font-display text-[20px] font-black" : "text-sm"}`}>
        {value}
      </td>
    </tr>
  );
}

function ExpenseTracker({ help }: { help: string }) {
  const headers = ["Date", "What it was for", "Amount", "Budget line", "Proof", "Checked"];
  return (
    <div className="border border-ink">
      <SectionBar title="Expense tracker" meta="Not connected" />
      <p className="border-b border-rule px-4 py-3 text-[13px]">
        {help} When spending is connected, each receipt will sit on a budget line. This tracker is not the Xero
        spend log. Actuals are read from Xero on the Dashboard, and they are not added up from outreach expenses.
        Nothing here asks for a Xero code.
      </p>
      <div className="max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink bg-bone">
              {headers.map((header) => (
                <th key={header} className="mono-label px-3 py-2 font-bold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-[13px] text-[color:var(--text-secondary)]">
                Nothing has been spent against this budget.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
