/**
 * The empty "Team budget (standard)" sheet.
 *
 * Section keys, labels and help match the template seeded in draft PR #475
 * (migration 278). Only fixed and variable hold lines. A line total is
 * amount × frequency × multiplier, in cents, via budget-lines.ts — the same
 * sum the database trigger will store once those tables exist.
 *
 * Nothing in this file reads or writes the database.
 */

import { amountToCents, lineTotalCents, type BudgetLineKind } from "@/lib/finance/budget-lines";

export const TEAM_BUDGET_TEMPLATE_KEY = "team_standard";
export const TEAM_BUDGET_TEMPLATE_NAME = "Team budget (standard)";

export const BUDGET_SECTION_KEYS = [
  "overview",
  "dashboard",
  "variable",
  "fixed",
  "expense_tracker",
  "notes",
] as const;

export type BudgetSectionKey = (typeof BUDGET_SECTION_KEYS)[number];

export type BudgetSectionDef = {
  key: BudgetSectionKey;
  label: string;
  help: string;
  holdsLines: boolean;
};

/** The six sections of an empty team budget, in sheet order. No lines. */
export const TEAM_BUDGET_SECTIONS: readonly BudgetSectionDef[] = [
  {
    key: "overview",
    label: "Overview",
    help: "What this budget is for, who it covers and how it is funded.",
    holdsLines: false,
  },
  {
    key: "dashboard",
    label: "Dashboard",
    help: "Totals worked out from every line. Nothing to type here.",
    holdsLines: false,
  },
  {
    key: "variable",
    label: "Variable cost",
    help: "Repeating costs: price each × how many times × how many people or items.",
    holdsLines: true,
  },
  {
    key: "fixed",
    label: "Fixed cost",
    help: "One-off purchases: price each × quantity.",
    holdsLines: true,
  },
  {
    key: "expense_tracker",
    label: "Expense tracker",
    help: "Receipts and spending, once they are connected.",
    holdsLines: false,
  },
  {
    key: "notes",
    label: "Notes",
    help: "Anything else finance or the team should know.",
    holdsLines: false,
  },
];

export const BUDGET_OWNER_KINDS = [
  "staff_ministry",
  "ministry_subcategory",
  "program",
  "event",
] as const;

export type BudgetOwnerKind = (typeof BUDGET_OWNER_KINDS)[number];

export const OWNER_KIND_LABEL: Record<BudgetOwnerKind, string> = {
  staff_ministry: "Staff ministry",
  ministry_subcategory: "Ministry sub-category",
  program: "School",
  event: "Event",
};

export const PERIOD_KINDS = ["year", "term", "event"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_KIND_LABEL: Record<PeriodKind, string> = {
  year: "Year",
  term: "Term",
  event: "Event",
};

export type BudgetCurrency = "ZAR" | "USD";

export type SheetLine = {
  id: string;
  kind: BudgetLineKind;
  name: string;
  /** Major units as typed: "190", "2,400.50". */
  amount: string;
  frequency: string;
  multiplier: string;
  usesDriver: boolean;
  notes: string;
};

export type BudgetSheetDraft = {
  name: string;
  ownerKind: BudgetOwnerKind | "";
  ownerId: string;
  orgId: string;
  periodKind: PeriodKind | "";
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Overview prose. No column for this on the draft budget model — see the PR. */
  purpose: string;
  driverLabel: string;
  driverValue: string;
  fundingGoal: string;
  fundsInHand: string;
  incomeGoal: string;
  fundraisingGoal: string;
  notes: string;
  lines: SheetLine[];
};

export function emptyBudgetDraft(): BudgetSheetDraft {
  return {
    name: "",
    ownerKind: "",
    ownerId: "",
    orgId: "",
    periodKind: "",
    periodLabel: "",
    periodStart: "",
    periodEnd: "",
    purpose: "",
    driverLabel: "",
    driverValue: "",
    fundingGoal: "",
    fundsInHand: "",
    incomeGoal: "",
    fundraisingGoal: "",
    notes: "",
    lines: [],
  };
}

export function newSheetLine(kind: BudgetLineKind, id: string): SheetLine {
  return {
    id,
    kind,
    name: "",
    amount: "",
    frequency: "1",
    multiplier: "1",
    usesDriver: false,
    notes: "",
  };
}

const MAX_LINES = 400;
const MAX_TEXT = 4000;

function asText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, max);
}

function isOwnerKind(value: string): value is BudgetOwnerKind {
  return (BUDGET_OWNER_KINDS as readonly string[]).includes(value);
}

function isPeriodKind(value: string): value is PeriodKind {
  return (PERIOD_KINDS as readonly string[]).includes(value);
}

function isLineKind(value: string): value is BudgetLineKind {
  return value === "fixed" || value === "variable";
}

/** Restores a draft from JSON. Garbage returns null so the sheet stays empty. */
export function parseBudgetDraft(value: unknown): BudgetSheetDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = asText(raw.name, 200);
  const ownerKind = asText(raw.ownerKind, 40);
  const ownerId = asText(raw.ownerId, 80);
  const orgId = asText(raw.orgId, 80);
  const periodKind = asText(raw.periodKind, 20);
  const periodLabel = asText(raw.periodLabel, 120);
  const periodStart = asText(raw.periodStart, 10);
  const periodEnd = asText(raw.periodEnd, 10);
  const purpose = asText(raw.purpose);
  const driverLabel = asText(raw.driverLabel, 80);
  const driverValue = asText(raw.driverValue, 20);
  const fundingGoal = asText(raw.fundingGoal, 40);
  const fundsInHand = asText(raw.fundsInHand, 40);
  const incomeGoal = asText(raw.incomeGoal, 40);
  const fundraisingGoal = asText(raw.fundraisingGoal, 40);
  const notes = asText(raw.notes);
  if (
    name === null ||
    ownerKind === null ||
    ownerId === null ||
    orgId === null ||
    periodKind === null ||
    periodLabel === null ||
    periodStart === null ||
    periodEnd === null ||
    purpose === null ||
    driverLabel === null ||
    driverValue === null ||
    fundingGoal === null ||
    fundsInHand === null ||
    incomeGoal === null ||
    fundraisingGoal === null ||
    notes === null ||
    !Array.isArray(raw.lines)
  ) {
    return null;
  }

  const lines: SheetLine[] = [];
  const seen = new Set<string>();
  for (const item of raw.lines) {
    if (lines.length >= MAX_LINES) break;
    if (!item || typeof item !== "object") continue;
    const line = item as Record<string, unknown>;
    const id = asText(line.id, 80);
    const kind = asText(line.kind, 20);
    const lineName = asText(line.name, 200);
    const amount = asText(line.amount, 40);
    const frequency = asText(line.frequency, 20);
    const multiplier = asText(line.multiplier, 20);
    const lineNotes = asText(line.notes, 500);
    if (!id || !kind || !isLineKind(kind) || lineName === null || amount === null || frequency === null || multiplier === null || lineNotes === null) {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push({
      id,
      kind,
      name: lineName,
      amount,
      frequency,
      multiplier,
      usesDriver: line.usesDriver === true,
      notes: lineNotes,
    });
  }

  return {
    name,
    ownerKind: ownerKind === "" || isOwnerKind(ownerKind) ? ownerKind : "",
    ownerId,
    orgId,
    periodKind: periodKind === "" || isPeriodKind(periodKind) ? periodKind : "",
    periodLabel,
    periodStart,
    periodEnd,
    purpose,
    driverLabel,
    driverValue,
    fundingGoal,
    fundsInHand,
    incomeGoal,
    fundraisingGoal,
    notes,
    lines,
  };
}

export function draftIsDirty(draft: BudgetSheetDraft): boolean {
  const empty = emptyBudgetDraft();
  return (Object.keys(empty) as (keyof BudgetSheetDraft)[]).some((key) => {
    if (key === "lines") return draft.lines.length > 0;
    return draft[key] !== empty[key];
  });
}

/** A non-negative bare number. Blank or junk → null. */
export function parseFactor(value: string): number | null {
  const s = value.trim();
  if (s === "" || !/^\d*(\.\d*)?$/.test(s) || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseDriver(value: string): number | null {
  return parseFactor(value);
}

export type LineMath =
  | { ok: true; cents: number; driverMissing: boolean }
  | { ok: false; reason: "amount" | "frequency" | "multiplier" };

/**
 * The total a row shows while someone is typing.
 * Fixed lines always use frequency 1. A line that follows the driver
 * uses the driver's value, or 0 when the driver is still blank.
 * A negative amount is refused — stored amounts are zero or more.
 */
export function lineMath(line: SheetLine, driverValue: number | null): LineMath {
  const typed = line.amount.trim();
  if (typed === "") return { ok: false, reason: "amount" };
  const amount = amountToCents(typed);
  if (amount === null || amount < 0) return { ok: false, reason: "amount" };

  const frequency = line.kind === "fixed" ? 1 : parseFactor(line.frequency);
  if (frequency === null) return { ok: false, reason: "frequency" };

  const driverMissing = line.usesDriver && driverValue === null;
  const multiplier = line.usesDriver ? (driverValue ?? 0) : parseFactor(line.multiplier);
  if (multiplier === null) return { ok: false, reason: "multiplier" };

  return {
    ok: true,
    driverMissing,
    cents: lineTotalCents(
      {
        amount_cents: amount,
        frequency,
        multiplier,
        uses_driver: line.usesDriver,
      },
      driverValue
    ),
  };
}

export type SectionRollup = {
  count: number;
  ready: number;
  incomplete: number;
  cents: number;
};

export function rollup(lines: SheetLine[], kind: BudgetLineKind, driverValue: number | null): SectionRollup {
  const mine = lines.filter((line) => line.kind === kind);
  let cents = 0;
  let ready = 0;
  let incomplete = 0;
  for (const line of mine) {
    const math = lineMath(line, driverValue);
    if (!math.ok) {
      incomplete += 1;
      continue;
    }
    ready += 1;
    cents += math.cents;
  }
  return { count: mine.length, ready, incomplete, cents };
}

/** Optional overview money. Blank is "not used". Junk or a negative is invalid. */
export function parseOptionalMoney(value: string): { state: "blank" } | { state: "invalid" } | { state: "cents"; cents: number } {
  if (value.trim() === "") return { state: "blank" };
  const cents = amountToCents(value);
  if (cents === null || cents < 0) return { state: "invalid" };
  return { state: "cents", cents };
}

export function periodProblem(draft: Pick<BudgetSheetDraft, "periodKind" | "periodLabel" | "periodStart" | "periodEnd">): string | null {
  if (!draft.periodKind) return "Choose a year, a term, or an event.";
  if (!draft.periodLabel.trim()) return "Name the period.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.periodEnd)) {
    return "A period needs a start date and an end date.";
  }
  if (draft.periodEnd < draft.periodStart) return "The period ends before it starts.";
  return null;
}

export type ScopeGap = "name" | "owner" | "organisation" | "period";

export function scopeGaps(draft: BudgetSheetDraft): ScopeGap[] {
  const gaps: ScopeGap[] = [];
  if (!draft.name.trim()) gaps.push("name");
  if (!draft.ownerKind || !draft.ownerId) gaps.push("owner");
  if (!draft.orgId) gaps.push("organisation");
  if (periodProblem(draft)) gaps.push("period");
  return gaps;
}

const GAP_PHRASE: Record<ScopeGap, string> = {
  name: "a name",
  owner: "one owner",
  organisation: "one organisation",
  period: "a real period",
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The single NeedsYou sentence. Scope first, then the fact that nothing is saved. */
export function needsYouCopy(gaps: ScopeGap[]): string {
  if (gaps.length > 0) {
    return `This budget still needs ${joinList(gaps.map((gap) => GAP_PHRASE[gap]))}. A budget is one owner, one organisation, one currency, and one period.`;
  }
  return "This sheet adds up here, and only here. It is not saved in the Hub — refreshing the page clears it. Approval, Xero coding and spending are not connected yet.";
}

export function formatBudgetMoney(cents: number, currency: BudgetCurrency | null): string {
  const amount = cents / 100;
  if (!currency) {
    return new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-ZA", {
    style: "currency",
    currency,
  }).format(amount);
}

export function currencyFromRecord(record: string | null | undefined): BudgetCurrency | null {
  if (record === "ZAR" || record === "USD") return record;
  return null;
}
