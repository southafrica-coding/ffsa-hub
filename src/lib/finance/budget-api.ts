/**
 * Speaks to the Next budget routes. It does not call database functions.
 *
 * POST /api/finance/budgets → 201 { budget, ignored }
 * GET  /api/finance/budgets/:id → { budget }
 * PUT  /api/finance/budgets/:id sends updatedAt from the last load.
 * It does not send status. A save cannot submit or approve.
 *
 * A 409 that asks for a reload wrote nothing. Other errors leave the
 * sheet as the caller still has it.
 */

import { amountToCents } from "@/lib/finance/budget-lines";
import {
  type BudgetOwnerKind,
  type BudgetSheetDraft,
  type SheetExpense,
  type SheetLine,
} from "@/lib/finance/budget-sheet";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CanonicalLine = {
  id: string;
  kind: "fixed" | "variable";
  name: string;
  amountCents: number;
  frequency: number;
  multiplier: number;
  usesDriver: boolean;
  lineTotalCents: number;
  notes: string | null;
  codingStatus: string;
  sort: number;
};

export type CanonicalExpense = {
  id: string;
  lineId: string | null;
  expenseDate: string;
  vendor: string | null;
  description: string;
  amountCents: number;
  reference: string | null;
  notes: string | null;
};

export type CanonicalPeriod = {
  id: string;
  kind: string;
  label: string;
  start: string;
  end: string;
};

export type CanonicalBudget = {
  id: string;
  name: string;
  status: string;
  orgId: string;
  currency: "ZAR";
  ownerKind: BudgetOwnerKind;
  ownerId: string;
  period: CanonicalPeriod | null;
  driverLabel: string | null;
  driverValue: number | null;
  fundingGoalCents: number | null;
  fundsInHandCents: number | null;
  incomeGoalCents: number | null;
  fundraisingGoalCents: number | null;
  notes: string | null;
  updatedAt: string;
  lines: CanonicalLine[];
  expenses: CanonicalExpense[];
};

export type BudgetListItem = {
  id: string;
  name: string;
  status: string;
  ownerKind: string;
  ownerId: string;
  periodLabel: string | null;
};

export type WorkbookWriteResult =
  | { kind: "saved"; budget: CanonicalBudget; ignored: string[] }
  | { kind: "stale"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "rejected"; message: string };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function centsToField(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function parseLine(value: unknown): CanonicalLine | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (row.kind !== "fixed" && row.kind !== "variable") return null;
  if (typeof row.name !== "string") return null;
  const amountCents = int(row.amountCents);
  const frequency = num(row.frequency);
  const multiplier = num(row.multiplier);
  const lineTotalCents = int(row.lineTotalCents);
  if (amountCents === null || frequency === null || multiplier === null || lineTotalCents === null) return null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountCents,
    frequency,
    multiplier,
    usesDriver: row.usesDriver === true,
    lineTotalCents,
    notes: typeof row.notes === "string" ? row.notes : null,
    codingStatus: typeof row.codingStatus === "string" ? row.codingStatus : "needs_coding",
    sort: int(row.sort) ?? 0,
  };
}

function parseExpense(value: unknown): CanonicalExpense | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (typeof row.expenseDate !== "string" || typeof row.description !== "string") return null;
  const amountCents = int(row.amountCents);
  if (amountCents === null) return null;
  const lineId = row.lineId === null ? null : typeof row.lineId === "string" ? row.lineId : null;
  if (row.lineId !== null && row.lineId !== undefined && lineId === null) return null;
  return {
    id: row.id,
    lineId,
    expenseDate: row.expenseDate,
    vendor: typeof row.vendor === "string" ? row.vendor : null,
    description: row.description,
    amountCents,
    reference: typeof row.reference === "string" ? row.reference : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  };
}

const OWNER_KINDS = new Set(["staff_ministry", "ministry_subcategory", "program", "event", "outreach_team"]);

export function parseCanonicalBudget(value: unknown): CanonicalBudget | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (typeof row.name !== "string" || typeof row.status !== "string") return null;
  if (typeof row.orgId !== "string" || row.currency !== "ZAR") return null;
  if (typeof row.ownerKind !== "string" || !OWNER_KINDS.has(row.ownerKind)) return null;
  if (typeof row.ownerId !== "string" || typeof row.updatedAt !== "string" || !row.updatedAt) return null;
  if (!Array.isArray(row.lines) || !Array.isArray(row.expenses)) return null;
  const periodRow = row.period === null ? null : record(row.period);
  if (row.period !== null && !periodRow) return null;
  let period: CanonicalPeriod | null = null;
  if (periodRow) {
    if (typeof periodRow.id !== "string" || typeof periodRow.label !== "string") return null;
    if (typeof periodRow.start !== "string" || typeof periodRow.end !== "string") return null;
    period = {
      id: periodRow.id,
      kind: typeof periodRow.kind === "string" ? periodRow.kind : "",
      label: periodRow.label,
      start: periodRow.start,
      end: periodRow.end,
    };
  }
  const lines: CanonicalLine[] = [];
  for (const item of row.lines) {
    const line = parseLine(item);
    if (!line) return null;
    lines.push(line);
  }
  const expenses: CanonicalExpense[] = [];
  for (const item of row.expenses) {
    const expense = parseExpense(item);
    if (!expense) return null;
    expenses.push(expense);
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    orgId: row.orgId,
    currency: "ZAR",
    ownerKind: row.ownerKind as BudgetOwnerKind,
    ownerId: row.ownerId,
    period,
    driverLabel: typeof row.driverLabel === "string" ? row.driverLabel : null,
    driverValue: num(row.driverValue),
    fundingGoalCents: row.fundingGoalCents === null ? null : int(row.fundingGoalCents),
    fundsInHandCents: row.fundsInHandCents === null ? null : int(row.fundsInHandCents),
    incomeGoalCents: row.incomeGoalCents === null ? null : int(row.incomeGoalCents),
    fundraisingGoalCents: row.fundraisingGoalCents === null ? null : int(row.fundraisingGoalCents),
    notes: typeof row.notes === "string" ? row.notes : null,
    updatedAt: row.updatedAt,
    lines,
    expenses,
  };
}

export function canonicalFromResponse(body: unknown): { budget: CanonicalBudget; ignored: string[] } | null {
  const row = record(body);
  const budget = parseCanonicalBudget(row?.budget);
  if (!budget) return null;
  const ignored = Array.isArray(row?.ignored) ? row.ignored.filter((item): item is string => typeof item === "string") : [];
  return { budget, ignored };
}

export function draftFromCanonical(budget: CanonicalBudget, purpose: string): BudgetSheetDraft {
  return {
    name: budget.name,
    ownerKind: budget.ownerKind,
    ownerId: budget.ownerId,
    org_id: budget.orgId,
    periodId: budget.period?.id ?? "",
    purpose,
    driverLabel: budget.driverLabel ?? "",
    driverValue: budget.driverValue === null ? "" : String(budget.driverValue),
    fundingGoal: budget.fundingGoalCents === null ? "" : centsToField(budget.fundingGoalCents),
    fundsInHand: budget.fundsInHandCents === null ? "" : centsToField(budget.fundsInHandCents),
    incomeGoal: budget.incomeGoalCents === null ? "" : centsToField(budget.incomeGoalCents),
    fundraisingGoal: budget.fundraisingGoalCents === null ? "" : centsToField(budget.fundraisingGoalCents),
    notes: budget.notes ?? "",
    lines: budget.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      name: line.name,
      amount: centsToField(line.amountCents),
      frequency: String(line.frequency),
      multiplier: String(line.multiplier),
      usesDriver: line.usesDriver,
      notes: line.notes ?? "",
      codingStatus: line.codingStatus,
    })),
    expenses: budget.expenses.map((expense) => ({
      id: expense.id,
      lineId: expense.lineId ?? "",
      expenseDate: expense.expenseDate,
      description: expense.description,
      amount: centsToField(expense.amountCents),
      reference: expense.reference ?? "",
      notes: expense.notes ?? "",
    })),
  };
}

function moneyField(value: string): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (value.trim() === "") return { ok: true, cents: null };
  const cents = amountToCents(value);
  if (cents === null || cents < 0) return { ok: false, error: "Use a number, or leave it blank." };
  return { ok: true, cents };
}

export function buildWorkbookBody(
  draft: BudgetSheetDraft,
  mode: "create" | "save",
  updatedAt: string | null
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!draft.name.trim() || !draft.ownerKind || !draft.ownerId || !draft.periodId) {
    return { ok: false, error: "Name the budget, choose who it belongs to, and choose a period." };
  }
  const lines = [];
  for (const line of draft.lines) {
    if (!UUID.test(line.id)) return { ok: false, error: "A line id has to be a real id." };
    if (!line.name.trim()) return { ok: false, error: "Every line needs a name." };
    const amountCents = amountToCents(line.amount);
    if (amountCents === null || amountCents < 0) return { ok: false, error: "Enter an amount for each line." };
    const frequency = line.kind === "fixed" ? 1 : Number(line.frequency);
    const multiplier = Number(line.multiplier);
    if (!Number.isFinite(frequency) || frequency < 0) return { ok: false, error: "Enter how many times for each variable line." };
    if (!line.usesDriver && (!Number.isFinite(multiplier) || multiplier < 0)) {
      return { ok: false, error: "Enter how many for each line." };
    }
    lines.push({
      id: line.id,
      kind: line.kind,
      name: line.name.trim(),
      amountCents,
      frequency,
      multiplier: line.usesDriver ? 0 : multiplier,
      usesDriver: line.usesDriver,
      notes: line.notes.trim() ? line.notes.trim() : null,
    });
  }
  const lineIds = new Set(lines.map((line) => line.id));
  const expenses = [];
  for (const expense of draft.expenses) {
    if (!UUID.test(expense.id)) return { ok: false, error: "An expense id has to be a real id." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.expenseDate)) return { ok: false, error: "Each expense needs a date." };
    if (!expense.description.trim()) return { ok: false, error: "Say what the expense was for." };
    const amountCents = amountToCents(expense.amount);
    if (amountCents === null || amountCents === 0) return { ok: false, error: "An expense needs an amount that isn't zero." };
    if (expense.lineId && !lineIds.has(expense.lineId)) {
      return { ok: false, error: "An expense has to sit on a line of this budget, or on none." };
    }
    expenses.push({
      id: expense.id,
      lineId: expense.lineId || null,
      expenseDate: expense.expenseDate,
      description: expense.description.trim(),
      amountCents,
      reference: expense.reference.trim() || null,
      notes: expense.notes.trim() || null,
    });
  }
  const fundingGoal = moneyField(draft.fundingGoal);
  const fundsInHand = moneyField(draft.fundsInHand);
  const incomeGoal = moneyField(draft.incomeGoal);
  const fundraisingGoal = moneyField(draft.fundraisingGoal);
  if (!fundingGoal.ok) return fundingGoal;
  if (!fundsInHand.ok) return fundsInHand;
  if (!incomeGoal.ok) return incomeGoal;
  if (!fundraisingGoal.ok) return fundraisingGoal;
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    ownerKind: draft.ownerKind,
    ownerId: draft.ownerId,
    periodId: draft.periodId,
    driverLabel: draft.driverLabel.trim() || null,
    driverValue: draft.driverValue.trim() === "" ? null : Number(draft.driverValue),
    fundingGoalCents: fundingGoal.cents,
    fundsInHandCents: fundsInHand.cents,
    incomeGoalCents: incomeGoal.cents,
    fundraisingGoalCents: fundraisingGoal.cents,
    notes: draft.notes.trim() || null,
    lines,
    expenses,
  };
  if (draft.org_id) body.orgId = draft.org_id;
  if (mode === "save") {
    if (!updatedAt) return { ok: false, error: "Reload this budget before saving." };
    body.updatedAt = updatedAt;
  }
  return { ok: true, body };
}

function messageOf(body: unknown): string {
  const row = record(body);
  if (!row) return "";
  if (typeof row.message === "string" && row.message) return row.message;
  if (typeof row.error === "string" && row.error !== "preview_writes_disabled" && row.error !== "schema_not_applied") return row.error;
  return "";
}

export function interpretBudgetWrite(status: number, body: unknown): WorkbookWriteResult {
  const row = record(body);
  const code = typeof row?.code === "string" ? row.code : typeof row?.error === "string" ? row.error : "";
  const message = messageOf(body);
  if (status === 503 || code === "schema_not_applied") {
    return {
      kind: "unavailable",
      message: message || "Saving a budget isn't available yet. The workbook tables aren't in the database. Your edits are still here.",
    };
  }
  if (status === 403 || code === "preview_writes_disabled") {
    return {
      kind: "forbidden",
      message: message || "You can't change this budget. Your edits are still here.",
    };
  }
  if (status === 409 && /someone else saved|reload/i.test(message)) {
    return { kind: "stale", message: message || "Someone else saved this budget. Reload it and try again." };
  }
  if (status === 409) {
    return { kind: "rejected", message: message || "The budget wasn't saved. Your edits are still here." };
  }
  if (status === 200 || status === 201) {
    const parsed = canonicalFromResponse(body);
    if (!parsed) {
      return { kind: "rejected", message: "The budget came back in a shape this sheet doesn't understand. Your edits are still here." };
    }
    return { kind: "saved", budget: parsed.budget, ignored: parsed.ignored };
  }
  return { kind: "rejected", message: message || "The budget wasn't saved. Your edits are still here." };
}

export function parseBudgetList(body: unknown): BudgetListItem[] | null {
  const row = record(body);
  if (!row || !Array.isArray(row.budgets)) return null;
  const items: BudgetListItem[] = [];
  for (const item of row.budgets) {
    const budget = record(item);
    if (!budget || typeof budget.id !== "string" || typeof budget.name !== "string") return null;
    const period = record(budget.period);
    items.push({
      id: budget.id,
      name: budget.name,
      status: typeof budget.status === "string" ? budget.status : "",
      ownerKind: typeof budget.ownerKind === "string" ? budget.ownerKind : "",
      ownerId: typeof budget.ownerId === "string" ? budget.ownerId : "",
      periodLabel: period && typeof period.label === "string" ? period.label : null,
    });
  }
  return items;
}

export function sheetSignature(draft: BudgetSheetDraft): string {
  const lines: SheetLine[] = draft.lines;
  const expenses: SheetExpense[] = draft.expenses;
  return JSON.stringify({
    name: draft.name,
    ownerKind: draft.ownerKind,
    ownerId: draft.ownerId,
    org_id: draft.org_id,
    periodId: draft.periodId,
    purpose: draft.purpose,
    driverLabel: draft.driverLabel,
    driverValue: draft.driverValue,
    fundingGoal: draft.fundingGoal,
    fundsInHand: draft.fundsInHand,
    incomeGoal: draft.incomeGoal,
    fundraisingGoal: draft.fundraisingGoal,
    notes: draft.notes,
    lines,
    expenses,
  });
}
