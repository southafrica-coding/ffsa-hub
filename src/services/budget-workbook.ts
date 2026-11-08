/**
 * Save and load a sheet-shaped budget workbook.
 *
 * Creates go through create_budget_from_template as the signed-in user, so
 * the existing budget permissions decide who may create one — including an
 * outreach team workbook. org_id is the fiscal period's org, and that org
 * is the South Africa one (FFSA NPC, ZAR). Currency is that org's record
 * currency. This file does not write Xero coding or a Xero spend log.
 *
 * Line totals are left to the database trigger. "What this covers" is not
 * stored: there is no column for it. The Notes tab is budgets.notes.
 * Expense rows are budget_expenses.
 */

import {
  SCHEMA_NOT_APPLIED,
  TEAM_BUDGET_TEMPLATE_KEY,
  centsFromDb,
  isBudgetSchemaMissing,
  isUuid,
  multiplierForLine,
  numberFromDb,
  ownerColumn,
  ownerIdFromRow,
  parseWorkbookWrite,
  periodOrgDecision,
  safeLineTotal,
  type BudgetOwnerKind,
  type SouthAfricaOrg,
  type WorkbookExpenseInput,
  type WorkbookLineInput,
  type WorkbookWrite,
} from "@/lib/finance/budget-workbook";
import { randomUUID } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const FINANCE_ORG_COLUMNS = "id, key, name, record_currency, is_active";

export type OrgReader = {
  /** Read by finance_orgs.key. Used when the signed-in user cannot see the NPC row. */
  readFinanceOrg: (key: string) => Promise<{ data: SouthAfricaOrg | null; error: { code?: string; message?: string } | null }>;
  /** Read by id. Used to check the fiscal period's org without swapping it. */
  readFinanceOrgById?: (id: string) => Promise<{ data: SouthAfricaOrg | null; error: { code?: string; message?: string } | null }>;
};

export type ApiResult = { status: number; body: Record<string, unknown> };

type DbError = { code?: string; message?: string } | null;

type BudgetRow = {
  id: string;
  name: string;
  status: string;
  org_id: string;
  currency: string;
  owner_kind: string;
  staff_ministry_id: string | null;
  subcategory_id: string | null;
  program_id: string | null;
  event_id: string | null;
  outreach_team_id: string | null;
  period_id: string;
  driver_label: string | null;
  driver_value: number | string | null;
  funding_goal_cents: number | string | null;
  funds_in_hand_cents: number | string | null;
  income_goal_cents: number | string | null;
  fundraising_goal_cents: number | string | null;
  notes: string | null;
  archived_at: string | null;
  updated_at?: string | null;
};

type PeriodRow = {
  id: string;
  org_id: string;
  label: string;
  kind: string;
  start_date: string;
  end_date: string;
  archived_at: string | null;
};

type SectionRow = { id: string; key: string; label: string; sort: number };
type LineRow = {
  id: string;
  section_id: string;
  kind: "fixed" | "variable";
  name: string;
  amount_cents: number | string;
  frequency: number | string;
  multiplier: number | string;
  uses_driver: boolean;
  line_total_cents: number | string | null;
  sort: number;
  notes: string | null;
  coding_status: string;
  archived_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type ExpenseRow = {
  id: string;
  line_id: string | null;
  expense_date: string;
  vendor: string | null;
  description: string;
  amount_cents: number | string;
  reference: string | null;
  notes: string | null;
  archived_at: string | null;
  updated_at?: string | null;
};

const BUDGET_COLUMNS =
  "id, name, status, org_id, currency, owner_kind, staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id, period_id, driver_label, driver_value, funding_goal_cents, funds_in_hand_cents, income_goal_cents, fundraising_goal_cents, notes, archived_at, updated_at";

function fail(status: number, error: string, extra?: Record<string, unknown>): ApiResult {
  return { status, body: { error, ...extra } };
}

function schemaMissing(): ApiResult {
  return { status: 503, body: { ...SCHEMA_NOT_APPLIED } };
}

const RELOAD_CONFLICT = "Someone else saved this budget. Reload it and try again.";

function mapDbError(error: DbError, action: "create" | "save" | "period" | "read"): ApiResult {
  if (!error) return fail(500, action === "read" ? "The budget couldn't be read." : "The budget couldn't be saved.");
  if (isBudgetSchemaMissing(error)) return schemaMissing();
  if (error.code === "preview_writes_disabled") {
    return {
      status: 403,
      body: {
        error: "preview_writes_disabled",
        message: error.message || "This preview deployment cannot change budgets.",
      },
    };
  }
  const message = error.message ?? "";
  if (error.code === "42501" || /row-level security/i.test(message)) {
    if (action === "period") {
      return fail(403, "You can't add that period. Someone who edits budgets has to add it first.");
    }
    if (action === "create") return fail(403, "You can't create a budget for that owner.");
    return fail(403, "You can't change this budget.");
  }
  if (error.code === "23505") {
    if (action === "period") return fail(409, "A period with that name already exists.");
    if (action === "save") return fail(409, "That row is already saved.");
    return fail(
      409,
      "A budget with this name already exists for that owner and period. If a previous save stopped halfway, open that budget and finish it, or archive it first."
    );
  }
  if (error.code === "23503") return fail(400, "That owner or line wasn't found.");
  if (/South Africa only|Hub budgets are in ZAR/i.test(message)) {
    return fail(400, "Budgets are for South Africa only, in rand.");
  }
  if (/Budget org comes from the fiscal period/i.test(message)) {
    return fail(400, "The organisation comes from the period.");
  }
  if (/approved budget cannot be changed/i.test(message)) {
    return fail(403, "An approved budget can't be changed until it is reopened.");
  }
  if (/once it is submitted/i.test(message)) {
    return fail(403, "Only finance can change a budget after it is submitted.");
  }
  if (/cannot be changed/i.test(message)) return fail(400, "A budget's owner and period stay as they were.");
  if (/period not found/i.test(message)) return fail(400, "That period isn't available.");
  if (/template not found|not active/i.test(message)) return schemaMissing();
  if (/not for owner kind/i.test(message)) return fail(400, "That template doesn't cover this owner.");
  if (/name is required/i.test(message)) return fail(400, "Name the budget.");
  if (/live line/i.test(message)) return fail(400, "An expense has to sit on a line of this budget, or on none.");
  if (error.code === "22023" || error.code === "23514") {
    return fail(400, "That budget doesn't fit the rules.");
  }
  if (/finance_private|hub data|schema cache|violates|constraint/i.test(message)) {
    return fail(action === "read" ? 500 : 400, action === "read" ? "The budget couldn't be read." : "That budget doesn't fit the rules.");
  }
  return fail(action === "read" ? 500 : 500, action === "read" ? "The budget couldn't be read." : "The budget couldn't be saved.");
}

async function probe(supabase: Client): Promise<ApiResult | null> {
  const { error } = await supabase.from("budgets").select("id").limit(1);
  if (!error) return null;
  if (isBudgetSchemaMissing(error)) return schemaMissing();
  return fail(500, "The budget couldn't be read.");
}

async function readOrgRow(
  supabase: Client,
  lookup: { id?: string; key?: string },
  deps?: OrgReader
): Promise<{ row: SouthAfricaOrg | null } | { failure: ApiResult }> {
  let query = supabase.from("finance_orgs").select(FINANCE_ORG_COLUMNS);
  query = lookup.id ? query.eq("id", lookup.id) : query.eq("key", lookup.key);
  const own = await query.maybeSingle();
  if (own.error && isBudgetSchemaMissing(own.error)) {
    return { failure: fail(503, "South Africa organisation couldn't be read.") };
  }
  if (own.data) return { row: own.data as SouthAfricaOrg };
  if (!deps) return { row: null };
  if (lookup.id) {
    if (!deps.readFinanceOrgById) return { row: null };
    return finishOrgRead(await deps.readFinanceOrgById(lookup.id));
  }
  return finishOrgRead(await deps.readFinanceOrg(lookup.key ?? "npc"));
}

function finishOrgRead(result: {
  data: SouthAfricaOrg | null;
  error: { code?: string; message?: string } | null;
}): { row: SouthAfricaOrg | null } | { failure: ApiResult } {
  if (result.error?.code === "preview_writes_disabled") return { failure: mapDbError(result.error, "read") };
  if (result.error && isBudgetSchemaMissing(result.error)) {
    return { failure: fail(503, "South Africa organisation couldn't be read.") };
  }
  if (result.error) return { failure: fail(503, "South Africa organisation couldn't be read.") };
  return { row: result.data };
}

function periodView(row: PeriodRow) {
  return { id: row.id, kind: row.kind, label: row.label, start: row.start_date, end: row.end_date };
}

function samePeriod(row: PeriodRow, input: NonNullable<WorkbookWrite["period"]>): boolean {
  return row.kind === input.kind && row.label.trim().toLowerCase() === input.label.trim().toLowerCase() && row.start_date === input.start && row.end_date === input.end;
}

async function loadPeriodById(supabase: Client, periodId: string): Promise<{ period: PeriodRow } | { failure: ApiResult }> {
  const { data, error } = await supabase
    .from("fiscal_periods")
    .select("id, org_id, label, kind, start_date, end_date, archived_at")
    .eq("id", periodId)
    .maybeSingle();
  if (error) return { failure: mapDbError(error, "period") };
  if (!data || data.archived_at) return { failure: fail(400, "That period isn't available.") };
  return { period: data };
}

async function loadTemplate(supabase: Client): Promise<{ id: string } | { failure: ApiResult }> {
  const { data, error } = await supabase
    .from("budget_templates")
    .select("id")
    .eq("key", TEAM_BUDGET_TEMPLATE_KEY)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return { failure: mapDbError(error, "create") };
  if (!data?.id) return { failure: schemaMissing() };
  return { id: data.id };
}

function sectionByKind(sections: SectionRow[]): Map<string, SectionRow> {
  return new Map(sections.map((section) => [section.key, section]));
}

async function loadSections(supabase: Client, budgetId: string): Promise<{ sections: SectionRow[] } | { failure: ApiResult }> {
  const { data, error } = await supabase.from("budget_sections").select("id, key, label, sort").eq("budget_id", budgetId);
  if (error) return { failure: mapDbError(error, "read") };
  return { sections: (data ?? []) as SectionRow[] };
}

async function loadLines(supabase: Client, budgetId: string): Promise<{ lines: LineRow[] } | { failure: ApiResult }> {
  const { data, error } = await supabase
    .from("budget_lines")
    .select("id, section_id, kind, name, amount_cents, frequency, multiplier, uses_driver, line_total_cents, sort, notes, coding_status, archived_at, created_at, updated_at")
    .eq("budget_id", budgetId);
  if (error) return { failure: mapDbError(error, "read") };
  return { lines: (data ?? []) as LineRow[] };
}

async function loadExpenses(supabase: Client, budgetId: string): Promise<{ expenses: ExpenseRow[] } | { failure: ApiResult }> {
  const { data, error } = await supabase
    .from("budget_expenses")
    .select("id, line_id, expense_date, vendor, description, amount_cents, reference, notes, archived_at, updated_at")
    .eq("budget_id", budgetId);
  if (error) return { failure: mapDbError(error, "read") };
  return { expenses: (data ?? []) as ExpenseRow[] };
}

function linePayload(line: WorkbookLineInput, sectionId: string, driverValue: number | null) {
  const multiplier = multiplierForLine(line, driverValue);
  const stored = { ...line, multiplier };
  if (safeLineTotal({ amount_cents: stored.amountCents, frequency: stored.kind === "fixed" ? 1 : stored.frequency, multiplier }) === null) {
    return null;
  }
  return {
    section_id: sectionId,
    kind: line.kind,
    name: line.name,
    amount_cents: line.amountCents,
    frequency: line.kind === "fixed" ? 1 : line.frequency,
    multiplier,
    uses_driver: line.usesDriver,
    sort: line.sort,
    notes: line.notes,
  };
}

function lineUnchanged(existing: LineRow, payload: NonNullable<ReturnType<typeof linePayload>>): boolean {
  return (
    existing.section_id === payload.section_id &&
    existing.kind === payload.kind &&
    existing.name === payload.name &&
    (centsFromDb(existing.amount_cents) ?? 0) === payload.amount_cents &&
    (numberFromDb(existing.frequency) ?? 1) === payload.frequency &&
    (numberFromDb(existing.multiplier) ?? 0) === payload.multiplier &&
    existing.uses_driver === payload.uses_driver &&
    (existing.sort ?? 0) === payload.sort &&
    (existing.notes ?? null) === (payload.notes ?? null)
  );
}

function conflict(): ApiResult {
  return fail(409, RELOAD_CONFLICT);
}

/** 0 rows from a compare-and-swap: a changed updated_at is a conflict; an unchanged row is row-level security. */
async function missedWrite(
  supabase: Client,
  table: "budgets" | "budget_lines" | "budget_expenses",
  id: string,
  expectedUpdatedAt: string | null | undefined
): Promise<ApiResult> {
  const still = await supabase.from(table).select("id, archived_at, updated_at").eq("id", id).maybeSingle();
  if (still.error) return mapDbError(still.error, "read");
  if (!still.data || still.data.archived_at) return conflict();
  if (
    expectedUpdatedAt &&
    typeof still.data.updated_at === "string" &&
    !sameInstant(still.data.updated_at, expectedUpdatedAt)
  ) {
    return conflict();
  }
  return fail(403, "You can't change this budget.");
}

async function archiveRow(
  supabase: Client,
  table: "budget_lines" | "budget_expenses",
  id: string,
  budgetId: string,
  expectedUpdatedAt: string | null | undefined
): Promise<ApiResult | null> {
  let query = supabase
    .from(table)
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("budget_id", budgetId)
    .is("archived_at", null);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const archived = await query.select("id");
  if (archived.error) return mapDbError(archived.error, "save");
  if (Array.isArray(archived.data) && archived.data.length > 0) return null;
  return missedWrite(supabase, table, id, expectedUpdatedAt);
}

async function syncLines(
  supabase: Client,
  budgetId: string,
  lines: WorkbookLineInput[],
  driverValue: number | null,
  keepBecauseOfExpenses: Set<string>,
  snapshot?: LineRow[]
): Promise<ApiResult | null> {
  const sections = await loadSections(supabase, budgetId);
  if ("failure" in sections) return sections.failure;
  const byKind = sectionByKind(sections.sections);
  const existing = snapshot ? { lines: snapshot } : await loadLines(supabase, budgetId);
  if ("failure" in existing) return existing.failure;
  const live = new Map(existing.lines.filter((line) => !line.archived_at).map((line) => [line.id, line]));
  const kept = new Set<string>();

  for (const line of lines) {
    const section = byKind.get(line.kind);
    if (!section) return fail(500, "The budget is missing a section for that line.");
    const payload = linePayload(line, section.id, driverValue);
    if (!payload) return fail(400, "That line total is too large.");
    if (line.id && live.has(line.id)) {
      kept.add(line.id);
      const current = live.get(line.id) as LineRow;
      if (lineUnchanged(current, payload)) continue;
      const expectedUpdatedAt = current.updated_at;
      let update = supabase.from("budget_lines").update(payload).eq("id", line.id).eq("budget_id", budgetId);
      if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
      const updated = await update.select("id").maybeSingle();
      if (updated.error) return mapDbError(updated.error, "save");
      if (!updated.data) return missedWrite(supabase, "budget_lines", line.id, expectedUpdatedAt);
    } else {
      const id = line.id ?? randomUUID();
      kept.add(id);
      const inserted = await supabase
        .from("budget_lines")
        .insert({ ...payload, id, budget_id: budgetId })
        .select("id")
        .maybeSingle();
      if (inserted.error) return mapDbError(inserted.error, "save");
      if (!inserted.data) return fail(403, "You can't change this budget.");
    }
  }

  for (const [id] of live) {
    if (kept.has(id) || keepBecauseOfExpenses.has(id)) continue;
    const archived = await archiveRow(supabase, "budget_lines", id, budgetId, live.get(id)?.updated_at);
    if (archived) return archived;
  }
  return null;
}

async function syncExpenses(
  supabase: Client,
  budgetId: string,
  expenses: WorkbookExpenseInput[],
  liveLineIds: Set<string>,
  snapshot?: ExpenseRow[]
): Promise<ApiResult | null> {
  for (const expense of expenses) {
    if (expense.lineId && !liveLineIds.has(expense.lineId)) {
      return fail(400, "An expense has to sit on a line of this budget, or on none.");
    }
  }
  const existing = snapshot ? { expenses: snapshot } : await loadExpenses(supabase, budgetId);
  if ("failure" in existing) return existing.failure;
  const live = new Map(existing.expenses.filter((row) => !row.archived_at).map((row) => [row.id, row]));
  const kept = new Set<string>();

  for (const expense of expenses) {
    const payload = {
      line_id: expense.lineId,
      expense_date: expense.expenseDate,
      vendor: expense.vendor,
      description: expense.description,
      amount_cents: expense.amountCents,
      reference: expense.reference,
      notes: expense.notes,
    };
    if (expense.id && live.has(expense.id)) {
      kept.add(expense.id);
      const current = live.get(expense.id) as ExpenseRow;
      const unchanged =
        (current.line_id ?? null) === payload.line_id &&
        current.expense_date === payload.expense_date &&
        (current.vendor ?? null) === payload.vendor &&
        current.description === payload.description &&
        (centsFromDb(current.amount_cents) ?? 0) === payload.amount_cents &&
        (current.reference ?? null) === payload.reference &&
        (current.notes ?? null) === payload.notes;
      if (unchanged) continue;
      const expectedUpdatedAt = current.updated_at;
      let update = supabase.from("budget_expenses").update(payload).eq("id", expense.id).eq("budget_id", budgetId);
      if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
      const updated = await update.select("id").maybeSingle();
      if (updated.error) return mapDbError(updated.error, "save");
      if (!updated.data) return missedWrite(supabase, "budget_expenses", expense.id, expectedUpdatedAt);
    } else {
      const id = expense.id ?? randomUUID();
      kept.add(id);
      const inserted = await supabase
        .from("budget_expenses")
        .insert({ ...payload, id, budget_id: budgetId })
        .select("id")
        .maybeSingle();
      if (inserted.error) return mapDbError(inserted.error, "save");
      if (!inserted.data) return fail(403, "You can't change this budget.");
    }
  }

  for (const [id] of live) {
    if (kept.has(id)) continue;
    const archived = await archiveRow(supabase, "budget_expenses", id, budgetId, live.get(id)?.updated_at);
    if (archived) return archived;
  }
  return null;
}

function sheetRevision(budget: BudgetRow, lines: LineRow[], expenses: ExpenseRow[]): string | null {
  const stamps = [budget.updated_at, ...lines.filter((line) => !line.archived_at).map((line) => line.updated_at), ...expenses.filter((row) => !row.archived_at).map((row) => row.updated_at)].filter(
    (stamp): stamp is string => typeof stamp === "string" && stamp.length > 0
  );
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return left === right;
}

function toLine(row: LineRow) {
  return {
    id: row.id,
    sectionId: row.section_id,
    kind: row.kind,
    name: row.name,
    amountCents: centsFromDb(row.amount_cents) ?? 0,
    frequency: numberFromDb(row.frequency) ?? 1,
    multiplier: numberFromDb(row.multiplier) ?? 1,
    usesDriver: row.uses_driver === true,
    lineTotalCents: centsFromDb(row.line_total_cents) ?? 0,
    notes: row.notes,
    codingStatus: row.coding_status,
    sort: row.sort ?? 0,
  };
}

function toExpense(row: ExpenseRow) {
  return {
    id: row.id,
    lineId: row.line_id,
    expenseDate: row.expense_date,
    vendor: row.vendor,
    description: row.description,
    amountCents: centsFromDb(row.amount_cents) ?? 0,
    reference: row.reference,
    notes: row.notes,
  };
}

function toWorkbook(budget: BudgetRow, period: PeriodRow, sections: SectionRow[], lines: LineRow[], expenses: ExpenseRow[]) {
  const ownerKind = budget.owner_kind as BudgetOwnerKind;
  return {
    id: budget.id,
    name: budget.name,
    status: budget.status,
    orgId: budget.org_id,
    currency: "ZAR" as const,
    ownerKind,
    ownerId: ownerIdFromRow(budget),
    period: periodView(period),
    driverLabel: budget.driver_label,
    driverValue: numberFromDb(budget.driver_value),
    fundingGoalCents: centsFromDb(budget.funding_goal_cents),
    fundsInHandCents: centsFromDb(budget.funds_in_hand_cents),
    incomeGoalCents: centsFromDb(budget.income_goal_cents),
    fundraisingGoalCents: centsFromDb(budget.fundraising_goal_cents),
    notes: budget.notes,
    updatedAt: sheetRevision(budget, lines, expenses),
    sections: [...sections]
      .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
      .map((section) => ({
        id: section.id,
        key: section.key,
        label: section.label,
        sort: section.sort,
        holdsLines: section.key === "fixed" || section.key === "variable",
      })),
    lines: lines
      .filter((line) => !line.archived_at)
      .sort((a, b) => a.sort - b.sort || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id))
      .map(toLine),
    expenses: expenses
      .filter((row) => !row.archived_at)
      .sort((a, b) => a.expense_date.localeCompare(b.expense_date) || a.id.localeCompare(b.id))
      .map(toExpense),
  };
}

async function loadBudgetRow(supabase: Client, budgetId: string): Promise<{ budget: BudgetRow } | { failure: ApiResult }> {
  if (!isUuid(budgetId)) return { failure: fail(400, "That budget id isn't valid.") };
  const { data, error } = await supabase.from("budgets").select(BUDGET_COLUMNS).eq("id", budgetId).maybeSingle();
  if (error) return { failure: mapDbError(error, "read") };
  if (!data || data.currency !== "ZAR") return { failure: fail(404, "Budget not found") };
  return { budget: data as BudgetRow };
}

async function readWorkbook(supabase: Client, budget: BudgetRow): Promise<ApiResult> {
  const [periodResult, sections, lines, expenses] = await Promise.all([
    supabase
      .from("fiscal_periods")
      .select("id, org_id, label, kind, start_date, end_date, archived_at")
      .eq("id", budget.period_id)
      .maybeSingle(),
    loadSections(supabase, budget.id),
    loadLines(supabase, budget.id),
    loadExpenses(supabase, budget.id),
  ]);
  if (periodResult.error) return mapDbError(periodResult.error, "read");
  if (!periodResult.data) return fail(500, "This budget has no period.");
  if ("failure" in sections) return sections.failure;
  if ("failure" in lines) return lines.failure;
  if ("failure" in expenses) return expenses.failure;
  return { status: 200, body: { budget: toWorkbook(budget, periodResult.data, sections.sections, lines.lines, expenses.expenses) } };
}

export async function getBudgetWorkbook(supabase: Client, budgetId: string): Promise<ApiResult> {
  const blocked = await probe(supabase);
  if (blocked) return blocked;
  const loaded = await loadBudgetRow(supabase, budgetId);
  if ("failure" in loaded) return loaded.failure;
  return readWorkbook(supabase, loaded.budget);
}

export async function listBudgetWorkbooks(
  supabase: Client,
  options?: { ownerKind?: string | null; ownerId?: string | null }
): Promise<ApiResult> {
  const blocked = await probe(supabase);
  if (blocked) return blocked;
  const ownerKind = options?.ownerKind || null;
  const ownerId = options?.ownerId || null;
  if ((ownerKind && !ownerId) || (!ownerKind && ownerId)) {
    return fail(400, "Filter by an owner kind and an owner together.");
  }
  if (ownerKind && !["staff_ministry", "ministry_subcategory", "program", "event", "outreach_team"].includes(ownerKind)) {
    return fail(400, "Choose one owner.");
  }
  if (ownerId && !isUuid(ownerId)) return fail(400, "Choose one owner.");

  let query = supabase.from("budgets").select(BUDGET_COLUMNS).is("archived_at", null).eq("currency", "ZAR").order("name");
  if (ownerKind && ownerId) query = query.eq(ownerColumn(ownerKind as BudgetOwnerKind), ownerId);
  const { data, error } = await query;
  if (error) return mapDbError(error, "read");
  const rows = (data ?? []) as BudgetRow[];
  const periodIds = [...new Set(rows.map((row) => row.period_id).filter(Boolean))];
  let periods: PeriodRow[] = [];
  if (periodIds.length) {
    const periodResult = await supabase
      .from("fiscal_periods")
      .select("id, org_id, label, kind, start_date, end_date, archived_at")
      .in("id", periodIds);
    if (periodResult.error) return mapDbError(periodResult.error, "read");
    periods = (periodResult.data ?? []) as PeriodRow[];
  }
  const byId = new Map(periods.map((period) => [period.id, period]));
  return {
    status: 200,
    body: {
      budgets: rows.map((row) => {
        const period = byId.get(row.period_id) ?? null;
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          orgId: row.org_id,
          currency: "ZAR" as const,
          ownerKind: row.owner_kind,
          ownerId: ownerIdFromRow(row),
          period: period ? periodView(period) : null,
        };
      }),
    },
  };
}

function headerPatch(input: WorkbookWrite, mode: "create" | "save", current?: BudgetRow): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (input.present.name && input.name && (!current || input.name !== current.name)) patch.name = input.name;
  if (input.present.driverLabel) {
    const next = input.driverLabel ?? null;
    if (!current || next !== (current.driver_label ?? null)) patch.driver_label = next;
  }
  if (input.present.driverValue) {
    const next = input.driverValue ?? null;
    if (!current || next !== numberFromDb(current.driver_value)) patch.driver_value = next;
  }
  const money: [boolean, number | null | undefined, number | string | null | undefined, string][] = [
    [input.present.fundingGoalCents, input.fundingGoalCents, current?.funding_goal_cents, "funding_goal_cents"],
    [input.present.fundsInHandCents, input.fundsInHandCents, current?.funds_in_hand_cents, "funds_in_hand_cents"],
    [input.present.incomeGoalCents, input.incomeGoalCents, current?.income_goal_cents, "income_goal_cents"],
    [input.present.fundraisingGoalCents, input.fundraisingGoalCents, current?.fundraising_goal_cents, "fundraising_goal_cents"],
  ];
  for (const [present, value, currentValue, column] of money) {
    if (!present) continue;
    const next = value ?? null;
    if (!current || next !== centsFromDb(currentValue ?? null)) patch[column] = next;
  }
  if (input.present.notes) {
    const next = input.notes ?? null;
    if (!current || next !== (current.notes ?? null)) patch.notes = next;
  }
  if (mode === "create" && Object.keys(patch).length === 0) return null;
  return Object.keys(patch).length ? patch : null;
}

function scopeUnchanged(input: WorkbookWrite, budget: BudgetRow, period: PeriodRow | null): ApiResult | null {
  if (input.orgId && input.orgId !== budget.org_id) {
    return fail(400, "The organisation comes from the period.");
  }
  if (input.present.ownerKind && input.ownerKind !== budget.owner_kind) {
    return fail(400, "A budget's owner and period stay as they were.");
  }
  if (input.present.ownerId && input.ownerId !== ownerIdFromRow(budget)) {
    return fail(400, "A budget's owner and period stay as they were.");
  }
  if (input.periodId && input.periodId !== budget.period_id) {
    return fail(400, "A budget's owner and period stay as they were.");
  }
  if (input.period && (!period || !samePeriod(period, input.period))) {
    return fail(400, "A budget's owner and period stay as they were.");
  }
  if (input.present.status && input.status !== budget.status) {
    return fail(400, "This save doesn't submit or approve a budget.");
  }
  return null;
}

async function applyHeader(supabase: Client, budget: BudgetRow, patch: Record<string, unknown>): Promise<ApiResult | null> {
  let query = supabase.from("budgets").update(patch).eq("id", budget.id);
  if (budget.updated_at) query = query.eq("updated_at", budget.updated_at);
  const updated = await query.select("id").maybeSingle();
  if (updated.error) return mapDbError(updated.error, "save");
  if (!updated.data) return missedWrite(supabase, "budgets", budget.id, budget.updated_at);
  return null;
}

function expenseTargetsInPayload(input: WorkbookWrite): ApiResult | null {
  if (!input.expenses) return null;
  const ids = new Set((input.lines ?? []).flatMap((line) => (line.id ? [line.id] : [])));
  for (const expense of input.expenses) {
    if (expense.lineId && !ids.has(expense.lineId)) {
      return fail(400, "An expense has to sit on a line of this budget, or on none.");
    }
  }
  return null;
}

async function rejectUnknownExpenseLines(supabase: Client, budgetId: string, input: WorkbookWrite): Promise<ApiResult | null> {
  if (!input.expenses) return null;
  const ids = await expenseLineIds(supabase, budgetId, input.lines);
  if ("failure" in ids) return ids.failure;
  for (const expense of input.expenses) {
    if (expense.lineId && !ids.ids.has(expense.lineId)) {
      return fail(400, "An expense has to sit on a line of this budget, or on none.");
    }
  }
  return null;
}

async function expenseLineIds(
  supabase: Client,
  budgetId: string,
  lines: WorkbookLineInput[] | undefined
): Promise<{ ids: Set<string> } | { failure: ApiResult }> {
  if (lines) {
    return { ids: new Set(lines.flatMap((line) => (line.id ? [line.id] : []))) };
  }
  const existing = await loadLines(supabase, budgetId);
  if ("failure" in existing) return { failure: existing.failure };
  return { ids: new Set(existing.lines.filter((line) => !line.archived_at).map((line) => line.id)) };
}

/**
 * org_id is the fiscal period's org. That org must already be the active
 * NPC row in ZAR. A US period is rejected and left where it is. A passed
 * org id that is not the period's org is rejected. Currency sent by the
 * caller is never written; anything other than ZAR is refused earlier.
 */
async function choosePeriod(
  supabase: Client,
  input: WorkbookWrite,
  deps?: OrgReader
): Promise<{ period: PeriodRow } | { failure: ApiResult }> {
  if (input.periodId) {
    const loaded = await loadPeriodById(supabase, input.periodId);
    if ("failure" in loaded) return loaded;
    const orgRead = await readOrgRow(supabase, { id: loaded.period.org_id }, deps);
    if ("failure" in orgRead) return { failure: orgRead.failure };
    const decision = periodOrgDecision({ periodOrg: orgRead.row, passedOrgId: input.orgId });
    if (!decision.ok) return { failure: fail(400, decision.error) };
    if (loaded.period.org_id !== decision.orgId) {
      return { failure: fail(400, "Budgets are for South Africa only, in rand.") };
    }
    if (input.period && !samePeriod(loaded.period, input.period)) {
      return { failure: fail(400, "A budget's period stays as it was when you name a different one.") };
    }
    return { period: loaded.period };
  }

  return { failure: fail(400, "Choose a period that already exists.") };
}

function validateLineTotals(lines: WorkbookLineInput[] | undefined, driverValue: number | null): ApiResult | null {
  if (!lines) return null;
  for (const line of lines) {
    const multiplier = multiplierForLine(line, driverValue);
    const frequency = line.kind === "fixed" ? 1 : line.frequency;
    if (safeLineTotal({ amount_cents: line.amountCents, frequency, multiplier }) === null) {
      return fail(400, "That line total is too large.");
    }
  }
  return null;
}

function partialDraft(budgetId: string): ApiResult {
  return {
    status: 409,
    body: {
      error: "The budget was only partly saved. Open it and finish the save, or archive it before creating another with the same name.",
      code: "partial_draft",
      budgetId,
    },
  };
}

function partialSave(budgetId: string): ApiResult {
  return {
    status: 409,
    body: {
      error: "This save stopped partway. Reload the budget before trying again.",
      code: "partial_save",
      budgetId,
    },
  };
}

async function abandonDraft(supabase: Client, budgetId: string): Promise<boolean> {
  const archived = await supabase
    .from("budgets")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", budgetId)
    .is("archived_at", null)
    .select("id");
  if (archived.error || !Array.isArray(archived.data) || archived.data.length === 0) return false;
  return true;
}

async function finishPartialCreate(supabase: Client, budgetId: string, failure: ApiResult): Promise<ApiResult> {
  if (await abandonDraft(supabase, budgetId)) return failure;
  return partialDraft(budgetId);
}

async function revertHeader(supabase: Client, budget: BudgetRow, patch: Record<string, unknown>): Promise<boolean> {
  const undo: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) undo[key] = (budget as Record<string, unknown>)[key] ?? null;
  const reverted = await supabase.from("budgets").update(undo).eq("id", budget.id).select("id").maybeSingle();
  return !reverted.error && !!reverted.data;
}

export async function createBudgetWorkbook(supabase: Client, body: unknown, deps?: OrgReader): Promise<ApiResult> {
  const blocked = await probe(supabase);
  if (blocked) return blocked;
  const parsed = parseWorkbookWrite(body, "create");
  if (!parsed.ok) return fail(400, parsed.error);
  const input = parsed.value;
  if (!input.name || !input.ownerKind || !input.ownerId) return fail(400, "Name the budget.");

  const driverValue = input.present.driverValue ? (input.driverValue ?? null) : null;
  const tooBig = validateLineTotals(input.lines, driverValue);
  if (tooBig) return tooBig;
  const earlyExpense = expenseTargetsInPayload(input);
  if (earlyExpense) return earlyExpense;

  const period = await choosePeriod(supabase, input, deps);
  if ("failure" in period) return period.failure;
  const template = await loadTemplate(supabase);
  if ("failure" in template) return template.failure;

  const created = await supabase.rpc("create_budget_from_template", {
    p_template_id: template.id,
    p_owner_kind: input.ownerKind,
    p_owner_id: input.ownerId,
    p_period_id: period.period.id,
    p_org_id: period.period.org_id,
    p_name: input.name,
    p_currency: null,
    p_driver_label: input.present.driverLabel ? (input.driverLabel ?? null) : null,
    p_driver_value: input.present.driverValue ? (input.driverValue ?? null) : null,
    p_submit: false,
  });
  if (created.error) return mapDbError(created.error, "create");
  const budgetId = created.data;
  if (typeof budgetId !== "string" || !budgetId) return fail(500, "The budget wasn't created.");

  const patch = headerPatch(input, "create");
  if (patch) {
    const headerError = await applyHeader(supabase, { id: budgetId } as BudgetRow, patch);
    if (headerError) return finishPartialCreate(supabase, budgetId, headerError);
  }

  if (input.lines) {
    const lineError = await syncLines(supabase, budgetId, input.lines, driverValue, new Set());
    if (lineError) return finishPartialCreate(supabase, budgetId, lineError);
  }
  if (input.expenses) {
    const ids = await expenseLineIds(supabase, budgetId, input.lines);
    if ("failure" in ids) return finishPartialCreate(supabase, budgetId, ids.failure);
    const expenseError = await syncExpenses(supabase, budgetId, input.expenses, ids.ids);
    if (expenseError) return finishPartialCreate(supabase, budgetId, expenseError);
  }

  const loaded = await getBudgetWorkbook(supabase, budgetId);
  if (loaded.status !== 200) return loaded;
  return { status: 201, body: { ...loaded.body, ignored: [...new Set(input.ignored)] } };
}

export async function saveBudgetWorkbook(supabase: Client, budgetId: string, body: unknown): Promise<ApiResult> {
  const blocked = await probe(supabase);
  if (blocked) return blocked;
  const parsed = parseWorkbookWrite(body, "save");
  if (!parsed.ok) return fail(400, parsed.error);
  const input = parsed.value;
  const loaded = await loadBudgetRow(supabase, budgetId);
  if ("failure" in loaded) return loaded.failure;
  const budget = loaded.budget;

  let period: PeriodRow | null = null;
  if (input.period || input.periodId) {
    const periodResult = await supabase
      .from("fiscal_periods")
      .select("id, org_id, label, kind, start_date, end_date, archived_at")
      .eq("id", budget.period_id)
      .maybeSingle();
    if (periodResult.error) return mapDbError(periodResult.error, "read");
    period = periodResult.data;
  }
  const scope = scopeUnchanged(input, budget, period);
  if (scope) return scope;
  if (!input.updatedAt) {
    return fail(400, "Reload this budget before saving. The save needs the updatedAt from the last load.");
  }
  const [existingLines, existingExpenses] = await Promise.all([loadLines(supabase, budget.id), loadExpenses(supabase, budget.id)]);
  if ("failure" in existingLines) return existingLines.failure;
  if ("failure" in existingExpenses) return existingExpenses.failure;
  // This comparison is not a lock. Each later write repeats it inside one
  // UPDATE ... WHERE updated_at = <the value just read>. Two saves can both
  // pass here; the statement that loses the row matches nothing and reloads.
  const revision = sheetRevision(budget, existingLines.lines, existingExpenses.expenses);
  if (!revision || !sameInstant(input.updatedAt, revision)) {
    return conflict();
  }
  const expenseCheck = await rejectUnknownExpenseLines(supabase, budget.id, input);
  if (expenseCheck) return expenseCheck;
  const driverValue = input.present.driverValue ? (input.driverValue ?? null) : numberFromDb(budget.driver_value);
  const tooBig = validateLineTotals(input.lines, driverValue);
  if (tooBig) return tooBig;

  const patch = headerPatch(input, "save", budget);
  let wrote = false;
  if (patch) {
    const headerError = await applyHeader(supabase, budget, patch);
    if (headerError) return headerError;
    wrote = true;
  }

  const protectedLines = new Set<string>();
  if (!input.expenses) {
    for (const expense of existingExpenses.expenses) {
      if (!expense.archived_at && expense.line_id) protectedLines.add(expense.line_id);
    }
  }
  if (input.lines) {
    const lineError = await syncLines(supabase, budget.id, input.lines, driverValue, protectedLines, existingLines.lines);
    if (lineError) {
      if (wrote && patch && !(await revertHeader(supabase, budget, patch))) return partialSave(budget.id);
      return lineError;
    }
    wrote = true;
  }
  if (input.expenses) {
    const ids = await expenseLineIds(supabase, budget.id, input.lines);
    if ("failure" in ids) return wrote ? partialSave(budget.id) : ids.failure;
    const expenseError = await syncExpenses(supabase, budget.id, input.expenses, ids.ids, existingExpenses.expenses);
    if (expenseError) return wrote ? partialSave(budget.id) : expenseError;
  }

  const again = await getBudgetWorkbook(supabase, budget.id);
  if (again.status !== 200) return again;
  return { status: 200, body: { ...again.body, ignored: [...new Set(input.ignored)] } };
}
