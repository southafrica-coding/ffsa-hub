"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, KpiStrip, Masthead, MastheadButton, ModuleTabs, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { MoneyKpi } from "../money-kpi";
import type { BudgetLineKind } from "@/lib/finance/budget-lines";
import type { BudgetScopeOptions } from "@/lib/finance/budget-scope";
import {
  TEAM_BUDGET_SECTIONS,
  TEAM_BUDGET_TEMPLATE_NAME,
  OWNER_KIND_LABEL,
  PERIOD_KIND_LABEL,
  BUDGET_OWNER_KINDS,
  draftIsDirty,
  emptyBudgetDraft,
  formatBudgetMoney,
  needsYouCopy,
  newSheetExpense,
  newSheetLine,
  parseDriver,
  parseOptionalMoney,
  rollup,
  scopeGaps,
  type BudgetOwnerKind,
  type BudgetSectionKey,
  type BudgetSheetDraft,
  type SheetLine,
} from "@/lib/finance/budget-sheet";
import {
  buildWorkbookBody,
  draftFromCanonical,
  interpretBudgetWrite,
  parseBudgetList,
  parseWorkbookPeriods,
  sheetSignature,
  type WorkbookPeriod,
  type BudgetListItem,
  type CanonicalBudget,
} from "@/lib/finance/budget-api";
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
  const router = useRouter();
  const [draft, setDraft] = useState<BudgetSheetDraft>(emptyBudgetDraft);
  const [section, setSection] = useState<BudgetSectionKey>(initialSection);
  const [stamp, setStamp] = useState<{ id: string; updatedAt: string; status: string } | null>(null);
  const [baseline, setBaseline] = useState(() => sheetSignature(emptyBudgetDraft()));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">(budgetId ? "loading" : "ready");
  const [savedList, setSavedList] = useState<BudgetListItem[] | null>(null);
  const [listNote, setListNote] = useState<string | null>(null);
  const [loadedPeriod, setLoadedPeriod] = useState<CanonicalBudget["period"]>(null);
  const [offeredPeriods, setOfferedPeriods] = useState<WorkbookPeriod[]>([]);
  const [periodNote, setPeriodNote] = useState<string | null>(null);

  const driverValue = parseDriver(draft.driverValue);
  const variable = useMemo(() => rollup(draft.lines, "variable", driverValue), [draft.lines, driverValue]);
  const fixed = useMemo(() => rollup(draft.lines, "fixed", driverValue), [draft.lines, driverValue]);
  const totalCents = variable.cents + fixed.cents;
  const npc =
    options.orgs.find((item) => item.key === "npc" && item.currency === "ZAR" && !item.inactive) ?? null;
  const selectedOffered = offeredPeriods.find((period) => period.id === draft.periodId) ?? null;
  const shownPeriod =
    selectedOffered ?? (loadedPeriod && draft.periodId === loadedPeriod.id ? loadedPeriod : null);
  const currency = npc || stamp || offeredPeriods.some((period) => period.id === draft.periodId) ? "ZAR" : null;
  const gapPeriods = [
    ...offeredPeriods.map((period) => ({ id: period.id })),
    ...(loadedPeriod && draft.periodId === loadedPeriod.id
      ? [{ id: loadedPeriod.id, org_id: draft.org_id || undefined }]
      : []),
  ];
  const gaps = scopeGaps(draft, { npcId: npc?.id ?? (draft.org_id || null), periods: gapPeriods });
  const owners = draft.ownerKind ? options.owners[draft.ownerKind] : [];
  const owner = owners.find((item) => item.id === draft.ownerId) ?? null;

  useEffect(() => {
    if (!budgetId) return;
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/finance/budgets/${budgetId}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancel) return;
        const outcome = interpretBudgetWrite(res.status, body);
        if (outcome.kind === "saved") {
          const next = draftFromCanonical(outcome.budget, "");
          setDraft(next);
          setLoadedPeriod(outcome.budget.period);
          setBaseline(sheetSignature(next));
          setStamp({ id: outcome.budget.id, updatedAt: outcome.budget.updatedAt, status: outcome.budget.status });
          setPhase("ready");
          return;
        }
        setNotice(outcome.kind === "rejected" && res.status === 404 ? "That budget wasn't found." : outcome.message);
        setPhase(res.status === 404 ? "missing" : "ready");
      } catch {
        if (!cancel) {
          setNotice("The budget couldn't be read. Nothing here was saved.");
          setPhase("ready");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId]);

  useEffect(() => {
    if (budgetId) return;
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/finance/budgets", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancel) return;
        if (res.status === 503) {
          setListNote("Saved budgets aren't available yet.");
          setSavedList([]);
          return;
        }
        const list = parseBudgetList(body);
        if (!res.ok || !list) {
          setListNote("Saved budgets couldn't be read.");
          setSavedList([]);
          return;
        }
        setSavedList(list);
        setListNote(null);
      } catch {
        if (!cancel) setListNote("Saved budgets couldn't be read.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId]);

  useEffect(() => {
    if (stamp || !draft.ownerKind || !draft.ownerId) {
      setOfferedPeriods([]);
      setPeriodNote(null);
      return;
    }
    let cancel = false;
    setPeriodNote("Reading periods…");
    const ownerKind = draft.ownerKind;
    const ownerId = draft.ownerId;
    (async () => {
      try {
        const params = new URLSearchParams({ ownerKind, ownerId });
        const res = await fetch(`/api/finance/budgets/periods?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancel) return;
        const listed = parseWorkbookPeriods(body);
        if (res.ok && listed) {
          setOfferedPeriods(listed);
          setPeriodNote(listed.length === 0 ? "No period is available for this owner." : null);
          setDraft((prev) =>
            listed.some((period) => period.id === prev.periodId) ? prev : { ...prev, periodId: "", org_id: "" }
          );
          return;
        }
        setOfferedPeriods([]);
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string" && body.message
            ? body.message
            : "Periods for this owner could not be read.";
        setPeriodNote(message);
      } catch {
        if (!cancel) {
          setOfferedPeriods([]);
          setPeriodNote("Periods for this owner could not be read.");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [draft.ownerKind, draft.ownerId, stamp]);

  const dirty = sheetSignature(draft) !== baseline;
  const approved = stamp?.status === "approved";
  const structureLocked = saving || approved;
  const active = TEAM_BUDGET_SECTIONS.find((item) => item.key === section) ?? TEAM_BUDGET_SECTIONS[0];

  function adopt(budget: CanonicalBudget, purpose: string) {
    const next = draftFromCanonical(budget, purpose);
    setDraft(next);
    setLoadedPeriod(budget.period);
    setBaseline(sheetSignature(next));
    setStamp({ id: budget.id, updatedAt: budget.updatedAt, status: budget.status });
  }

  async function reloadSaved() {
    if (!stamp || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/finance/budgets/${stamp.id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      const outcome = interpretBudgetWrite(res.status, body);
      if (outcome.kind === "saved") {
        adopt(outcome.budget, "");
        setConflict(null);
        setNotice(null);
        return;
      }
      setNotice(outcome.message);
    } catch {
      setNotice("The saved copy couldn't be read. What you typed is still here.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSheet() {
    if (saving) return;
    const built = buildWorkbookBody(draft, stamp ? "save" : "create", stamp?.updatedAt ?? null);
    if (!built.ok) {
      setNotice(built.error);
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(stamp ? `/api/finance/budgets/${stamp.id}` : "/api/finance/budgets", {
        method: stamp ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const body = await res.json().catch(() => ({}));
      const outcome = interpretBudgetWrite(res.status, body);
      if (outcome.kind === "saved") {
        adopt(outcome.budget, draft.purpose);
        setConflict(null);
        if (!stamp) router.push(`/finance/budgets/${outcome.budget.id}`);
        return;
      }
      if (outcome.kind === "stale") {
        setConflict(outcome.message);
        return;
      }
      setNotice(outcome.message);
    } catch {
      setNotice("Couldn't reach the Hub. Your edits are still here.");
    } finally {
      setSaving(false);
    }
  }

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
    if (approved) return;
    if (draftIsDirty(draft) && !window.confirm("Clear this sheet? It is not saved anywhere else.")) return;
    setDraft(emptyBudgetDraft());
    setSection("overview");
  }

  const money = (cents: number) => formatBudgetMoney(cents, currency);
  const attention = gaps.length
    ? needsYouCopy(gaps)
    : !stamp
      ? "Save stores this sheet. Until you save, refreshing drops what you typed."
      : dirty
        ? "These changes aren't saved. Refreshing drops them."
        : null;

  if (phase === "loading") {
    return (
      <div data-testid="budget-sheet" className="max-w-full overflow-x-clip">
        <Masthead context="Finance · Budget" title="Budget" />
        <p className="px-5 py-8 text-sm md:px-8">Opening this budget…</p>
      </div>
    );
  }

  return (
    <div data-testid="budget-sheet" className="max-w-full overflow-x-clip">
      <Masthead
        context={draft.name.trim() ? `Finance · ${draft.name.trim()}` : `Finance · ${TEAM_BUDGET_TEMPLATE_NAME}`}
        title="Budget"
        actions={
          <>
            <StatusPill tone={stamp && !dirty ? "good" : "warn"}>{stamp ? (dirty ? "Unsaved" : stamp.status) : "Not saved"}</StatusPill>
            <MastheadButton onClick={saveSheet}>{saving ? "Saving…" : stamp ? "Save" : "Create"}</MastheadButton>
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

      {attention && <NeedsYou>{attention}</NeedsYou>}
      {notice && <p className="border-b border-rule px-5 py-3 text-[13px] text-amber md:px-8">{notice}</p>}
      {conflict && (
        <div className="flex flex-col gap-3 border-b border-ink bg-bone px-5 py-3 md:flex-row md:items-center md:justify-between md:px-8">
          <p className="text-[13px]">{conflict} Nothing you typed was overwritten.</p>
          <div className="flex gap-2">
            <button type="button" onClick={reloadSaved} className="min-h-11 border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white">
              Reload saved copy
            </button>
            <button type="button" onClick={() => setConflict(null)} className="min-h-11 border border-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
              Keep what I typed
            </button>
          </div>
        </div>
      )}
      {approved && (
        <p className="border-b border-rule px-5 py-3 text-[13px] md:px-8">
          This budget is approved. Lines, notes, and who it belongs to stay as they are until it is reopened. The expense
          tracker can still be updated.
        </p>
      )}
      {stamp?.status === "submitted" && (
        <p className="border-b border-rule px-5 py-3 text-[13px] md:px-8">
          This budget is submitted. Only finance can change it.
        </p>
      )}
      {!budgetId && (savedList || listNote) && (
        <div className="border-b border-rule px-5 py-3 md:px-8">
          <div className="mono-label">Saved budgets</div>
          {listNote && <p className="mt-2 text-[13px]">{listNote}</p>}
          {savedList && savedList.length > 0 && (
            <ul className="mt-2">
              {savedList.map((item) => (
                <li key={item.id} className="border-b border-rule py-2 text-sm">
                  <Link href={`/finance/budgets/${item.id}`} className="font-display text-[16px] font-black uppercase">
                    {item.name}
                  </Link>
                  <span className="mono-label ml-2">{[item.status, item.periodLabel].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
          {savedList && savedList.length === 0 && !listNote && <p className="mt-2 text-[13px]">No saved budgets yet.</p>}
        </div>
      )}

      <fieldset disabled={structureLocked} className="min-w-0 border-0 p-0">
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
            onChange={(e) => patch({ ownerId: e.target.value, periodId: "", org_id: "" })}
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
        <div className="bg-white px-3 py-3">
          <div className="mono-label">Organisation</div>
          <div className="mt-2 text-sm">{npc ? npc.name : stamp && draft.org_id ? "South Africa" : "—"}</div>
          <p className="mt-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">
            {npc
              ? "FFSA NPC. South Africa only. The organisation comes from the period."
              : stamp && draft.org_id
                ? "South Africa, in rand. The organisation came from the period."
                : shownPeriod
                  ? "The organisation is taken from the period when this budget is created."
                  : "Choose an owner. Periods for that owner are listed here. The organisation comes from the period."}
          </p>
        </div>
        <div className="bg-white px-3 py-3">
          <div className="mono-label">Currency</div>
          <div className="numeral mt-2 text-[28px] leading-none">{currency ?? "—"}</div>
          <p className="mt-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">
            {npc ? "Rand. Locked to FFSA NPC." : currency ? "Rand. The period list is South Africa only." : "Rand, once a period is chosen."}
          </p>
        </div>
        <div className="bg-white px-3 py-3 xl:col-span-3">
          <label className="block">
            <span className="mono-label">Period</span>
            {!stamp && offeredPeriods.length > 0 ? (
              <select
                className={control}
                aria-label="Period"
                value={selectedOffered?.id ?? ""}
                onChange={(e) => {
                  const period = offeredPeriods.find((row) => row.id === e.target.value);
                  patch({ periodId: period?.id ?? "", org_id: "" });
                }}
              >
                <option value="">Choose a period</option>
                {offeredPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {PERIOD_KIND_LABEL[period.kind]} · {period.label} · {period.start} – {period.end}
                    {period.current ? " · current" : ""}
                  </option>
                ))}
              </select>
            ) : loadedPeriod && draft.periodId === loadedPeriod.id ? (
              <p className="mt-2 text-sm">
                {(loadedPeriod.kind === "year" || loadedPeriod.kind === "term" || loadedPeriod.kind === "event"
                  ? PERIOD_KIND_LABEL[loadedPeriod.kind]
                  : loadedPeriod.kind)}{" "}
                · {loadedPeriod.label} · {loadedPeriod.start} – {loadedPeriod.end}
              </p>
            ) : (
              <p className="mt-2 text-[13px] leading-snug text-amber">
                {periodNote ?? "Choose an owner to see periods."}
              </p>
            )}
          </label>
          {shownPeriod && (
            <p className="mt-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">
              {shownPeriod.start} – {shownPeriod.end}. This period&apos;s organisation is the budget&apos;s.
            </p>
          )}
        </div>
        <div className="bg-bone px-3 py-3 sm:col-span-2 xl:col-span-4">
          <div className="mono-label">Xero codes</div>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-snug text-ink">
            You edit amounts and notes. Finance maps each line to a Xero code for South Africa.
            This sheet has no chart-of-accounts picker.
            {draft.lines.length > 0 && " Every line is not coded yet."}
          </p>
          {(owner || npc || shownPeriod) && (
            <p className="mono-label mt-3">
              {[
                owner?.label,
                npc?.name,
                currency,
                shownPeriod ? `${shownPeriod.label} · ${shownPeriod.start} – ${shownPeriod.end}` : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          )}
        </div>
      </div>
      </fieldset>

      <ModuleTabs
        tabs={TEAM_BUDGET_SECTIONS.map((item) => ({ key: item.key, label: item.label }))}
        active={section}
        onChange={(key) => setSection(key as BudgetSectionKey)}
      />

      <div className="min-w-0 max-w-full px-5 py-6 md:px-8" data-section={section}>
        {section !== "expense_tracker" && (
        <fieldset disabled={structureLocked} className="min-w-0 border-0 p-0">
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
        </fieldset>
        )}
        {section === "expense_tracker" && (
          <ExpenseTracker
            help={active.help}
            expenses={draft.expenses}
            lines={draft.lines}
            readOnly={saving}
            onAdd={() => setDraft((prev) => ({ ...prev, expenses: [...prev.expenses, newSheetExpense(newId())] }))}
            onChange={(id, expensePatch) =>
              setDraft((prev) => ({
                ...prev,
                expenses: prev.expenses.map((row) => (row.id === id ? { ...row, ...expensePatch } : row)),
              }))
            }
            onRemove={(id) => setDraft((prev) => ({ ...prev, expenses: prev.expenses.filter((row) => row.id !== id) }))}
          />
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
      <p className="border-b border-rule px-4 py-3 text-[13px]">{help} Lines are added on Variable cost and Fixed cost.</p>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
        <OverviewRow label="What this covers">
          <textarea
            aria-label="What this budget covers"
            className="min-h-[88px] w-full resize-y border border-ink bg-white px-2 py-2 text-sm outline-none focus:bg-bone"
            value={draft.purpose}
            placeholder="Who it is for, and what the money is meant to do."
            onChange={(e) => onChange({ purpose: e.target.value })}
          />
          <p className="mt-1.5 text-[12px] text-[color:var(--text-secondary)]">This description is not stored.</p>
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

function ExpenseTracker({
  help,
  expenses,
  lines,
  readOnly,
  onAdd,
  onChange,
  onRemove,
}: {
  help: string;
  expenses: BudgetSheetDraft["expenses"];
  lines: BudgetSheetDraft["lines"];
  readOnly: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<BudgetSheetDraft["expenses"][number]>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="border border-ink">
      <SectionBar title="Expense tracker" meta={`${expenses.length} ${expenses.length === 1 ? "row" : "rows"}`} />
      <div className="flex flex-col gap-3 border-b border-rule bg-bone px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-[13px] leading-snug">
          {help} These rows are this budget&apos;s expenses. They are not the Xero spend log, and they are not outreach
          expenses. Nothing here asks for a Xero code.
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          >
            Add an expense
          </button>
        )}
      </div>
      <div className="max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink bg-bone">
              {["Date", "What it was for", "Amount", "Budget line", "Proof", "Note", ""].map((header) => (
                <th key={header || "remove"} className="mono-label px-2 py-2 font-bold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-[13px] text-[color:var(--text-secondary)]">
                  Nothing has been spent against this budget.
                </td>
              </tr>
            )}
            {expenses.map((expense) => (
              <tr key={expense.id} className="border-b border-rule">
                <td className="p-0">
                  <input
                    type="date"
                    aria-label="Expense date"
                    className="h-11 w-full bg-transparent px-2 text-sm outline-none focus:bg-bone"
                    value={expense.expenseDate}
                    onChange={(e) => onChange(expense.id, { expenseDate: e.target.value })}
                  />
                </td>
                <td className="p-0">
                  <input
                    aria-label="What the expense was for"
                    className="h-11 w-full bg-transparent px-2 text-sm outline-none focus:bg-bone"
                    value={expense.description}
                    onChange={(e) => onChange(expense.id, { description: e.target.value })}
                  />
                </td>
                <td className="p-0">
                  <input
                    aria-label="Expense amount"
                    inputMode="decimal"
                    className="h-11 w-full bg-transparent px-2 text-right font-mono text-sm tabular-nums outline-none focus:bg-bone"
                    value={expense.amount}
                    onChange={(e) => onChange(expense.id, { amount: e.target.value })}
                  />
                </td>
                <td className="p-0">
                  <select
                    aria-label="Budget line"
                    className="h-11 w-full bg-transparent px-2 text-sm outline-none focus:bg-bone"
                    value={expense.lineId}
                    onChange={(e) => onChange(expense.id, { lineId: e.target.value })}
                  >
                    <option value="">No line</option>
                    {lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.name.trim() || "Untitled line"}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-0">
                  <input
                    aria-label="Proof"
                    className="h-11 w-full bg-transparent px-2 text-sm outline-none focus:bg-bone"
                    value={expense.reference}
                    onChange={(e) => onChange(expense.id, { reference: e.target.value })}
                  />
                </td>
                <td className="p-0">
                  <input
                    aria-label="Expense note"
                    className="h-11 w-full bg-transparent px-2 text-sm outline-none focus:bg-bone"
                    value={expense.notes}
                    onChange={(e) => onChange(expense.id, { notes: e.target.value })}
                  />
                </td>
                <td className="px-2">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onRemove(expense.id)}
                      className="min-h-11 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
