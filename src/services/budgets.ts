import type { BudgetLineKind } from "@/lib/finance/budget-lines";
import type { Database } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type CreateBudgetArgs = Database["public"]["Functions"]["create_budget_from_template"]["Args"];
type CopyBudgetArgs = Database["public"]["Functions"]["copy_budget_to_period"]["Args"];
type SaveTemplateArgs = Database["public"]["Functions"]["save_budget_as_template"]["Args"];

// Budgets (migrations 295–299). Pure data access: every call runs as the
// signed-in user, so RLS decides what they can see and change. Totals,
// coding status, org currency and the copied Xero coding are set by
// database triggers — nothing here sends them, and nothing here imports
// outreach_expenses. An outreach team can still own a workbook row.

export type BudgetOwnerKind =
  | "staff_ministry"
  | "ministry_subcategory"
  | "program"
  | "event"
  | "outreach_team";
export type BudgetCurrency = "ZAR" | "USD";
export type BudgetStatus = "draft" | "submitted" | "approved" | "archived";
export type XeroOrgRegion = "za" | "us";

const OWNER_COLUMN: Record<BudgetOwnerKind, string> = {
  staff_ministry: "staff_ministry_id",
  ministry_subcategory: "subcategory_id",
  program: "program_id",
  event: "event_id",
  outreach_team: "outreach_team_id",
};

// Hub budgets are FFSA NPC (ZAR). finance_orgs is not embedded: its narrower
// RLS would hide a member's budget row. A US period is rejected, not attached.
const BUDGET_DETAIL_SELECT = `
  *,
  fiscal_periods!budgets_period_org_fkey(id, org_id, label, kind, start_date, end_date),
  budget_sections!budget_sections_budget_id_fkey(id, key, label, sort, holds_lines),
  budget_lines!budget_lines_budget_id_fkey(
    *,
    budget_categories!budget_lines_category_id_fkey(id, key, name, group_name, icon)
  )
`;

// ────────────────────────────────────────────────────────────
// TEMPLATES
// ────────────────────────────────────────────────────────────

/**
 * Templates the user can see: the standard ones, plus saved ones for owners
 * they belong to (RLS). Pass an owner to narrow to standard + that owner's.
 * Pass orgId to keep the global template and that org's saved templates.
 */
export async function getBudgetTemplates(
  supabase: Client,
  options?: { ownerKind?: BudgetOwnerKind; ownerId?: string; orgId?: string }
) {
  let query = supabase
    .from("budget_templates")
    .select("*, budget_template_sections(id, key, label, help_text, sort, holds_lines)")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("name");
  if (options?.ownerKind && options.ownerId) {
    query = query.or(`owner_kind.is.null,${OWNER_COLUMN[options.ownerKind]}.eq.${options.ownerId}`);
  }
  if (options?.orgId) {
    query = query.or(`org_id.is.null,org_id.eq.${options.orgId}`);
  }
  return query;
}

/**
 * "Save as template": sections, live lines, driver, categories and Xero
 * coding — no approvals, history, actuals or receipts. The database keeps
 * the budget's org, currency and owner. Returns `{ data: templateId }`.
 */
export async function saveBudgetAsTemplate(supabase: Client, budgetId: string, name: string) {
  const args: SaveTemplateArgs = { p_budget_id: budgetId, p_name: name };
  return supabase.rpc("save_budget_as_template", args);
}

// ────────────────────────────────────────────────────────────
// BUDGETS
// ────────────────────────────────────────────────────────────

export type CreateBudgetInput = {
  templateId: string;
  ownerKind: BudgetOwnerKind;
  ownerId: string;
  periodId: string;
  /**
   * Optional check. The database sets org_id from the fiscal period, so a
   * leader does not read finance_orgs. Pass it only to reject a mismatch.
   */
  orgId?: string;
  name: string;
  currency?: BudgetCurrency;
  driverLabel?: string;
  driverValue?: number;
  /** Submit for approval straight away. Never approves. */
  submit?: boolean;
};

/**
 * A new draft (or submitted) budget from a template. The standard template
 * gives an EMPTY budget; a saved template also brings its lines and coding.
 * Returns `{ data: budgetId }`.
 */
export async function createBudgetFromTemplate(supabase: Client, input: CreateBudgetInput) {
  const args: CreateBudgetArgs = {
    p_template_id: input.templateId,
    p_owner_kind: input.ownerKind,
    p_owner_id: input.ownerId,
    p_period_id: input.periodId,
    p_org_id: input.orgId ?? null,
    p_name: input.name,
    p_currency: input.currency ?? null,
    p_driver_label: input.driverLabel ?? null,
    p_driver_value: input.driverValue ?? null,
    p_submit: input.submit ?? false,
  };
  return supabase.rpc("create_budget_from_template", args);
}

export type CopyBudgetInput = {
  sourceBudgetId: string;
  periodId: string;
  /** Defaults to the source budget's name. Org and currency stay with the source. */
  name?: string;
  submit?: boolean;
};

/**
 * Copies a budget into another period (next year / quarter / occurrence) for
 * the same owner and the same finance org. Draft, or submitted; never
 * approved. Coding is re-checked against Xero. Returns `{ data: budgetId }`.
 */
export async function copyBudgetToPeriod(supabase: Client, input: CopyBudgetInput) {
  const args: CopyBudgetArgs = {
    p_source_budget_id: input.sourceBudgetId,
    p_period_id: input.periodId,
    p_name: input.name ?? null,
    p_submit: input.submit ?? false,
  };
  return supabase.rpc("copy_budget_to_period", args);
}

export type ListBudgetsOptions = {
  orgId?: string;
  periodId?: string;
  status?: BudgetStatus;
  ownerKind?: BudgetOwnerKind;
  ownerId?: string;
};

/** Live budgets. They are FFSA NPC; orgId only narrows within that. */
export async function listBudgets(supabase: Client, options?: ListBudgetsOptions) {
  let query = supabase.from("budgets").select("id, name, org_id, currency, period_id, status, owner_kind").is("archived_at", null).order("name");
  if (options?.orgId) query = query.eq("org_id", options.orgId);
  if (options?.periodId) query = query.eq("period_id", options.periodId);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.ownerKind && options.ownerId) query = query.eq(OWNER_COLUMN[options.ownerKind], options.ownerId);
  return query;
}

/** Dashboard rows. Hub budgets are FFSA NPC in ZAR. */
export async function listBudgetOverviews(
  supabase: Client,
  options: { orgId: string; periodId?: string; status?: BudgetStatus }
) {
  let query = supabase.from("v_budget_overview").select("*").eq("org_id", options.orgId);
  if (options.periodId) query = query.eq("period_id", options.periodId);
  if (options.status) query = query.eq("status", options.status);
  return query;
}

/** One budget with its period, sections and live (not archived) lines, in order. */
export async function getBudget(supabase: Client, budgetId: string) {
  return supabase
    .from("budgets")
    .select(BUDGET_DETAIL_SELECT)
    .eq("id", budgetId)
    .is("budget_lines.archived_at", null)
    .order("sort", { referencedTable: "budget_sections" })
    .order("sort", { referencedTable: "budget_lines" })
    .order("created_at", { referencedTable: "budget_lines" })
    .single();
}

/** Header, goals and zero-safe plan/spend. One row even when the budget has no lines. */
export async function getBudgetOverview(supabase: Client, budgetId: string) {
  return supabase.from("v_budget_overview").select("*").eq("budget_id", budgetId).maybeSingle();
}

/** Variable or fixed planning lines for one budget, in section order. */
export async function getBudgetLines(supabase: Client, budgetId: string, kind: BudgetLineKind) {
  return supabase
    .from("v_budget_lines_flat")
    .select("*")
    .eq("budget_id", budgetId)
    .eq("kind", kind)
    .order("sort")
    .order("line_id");
}

/** Section and category planning totals for one budget. Plan only, no expenses. */
export async function getBudgetSummary(supabase: Client, budgetId: string) {
  return supabase.from("v_budget_summary").select("*").eq("budget_id", budgetId);
}

/** Year-over-year rows for a budget: per category, this total vs its source budget's. */
export async function getBudgetYearOverYear(supabase: Client, budgetId: string) {
  return supabase.from("v_budget_yoy").select("*").eq("budget_id", budgetId).order("category_name");
}

/** Planned vs recorded spend per line, including archived lines that still have spend. */
export async function getBudgetLineActuals(supabase: Client, budgetId: string) {
  return supabase.from("v_budget_line_actuals").select("*").eq("budget_id", budgetId);
}

/** Manual expense tracker rows for one budget, in date order. Includes unallocated rows. */
export async function getBudgetExpenseTracker(supabase: Client, budgetId: string) {
  return supabase
    .from("v_budget_expense_tracker")
    .select("*")
    .eq("budget_id", budgetId)
    .order("expense_date")
    .order("expense_id");
}

/**
 * Finance coding queue for one budget. The view itself is limited to code
 * managers and recomputes invalid accounts against the current mirror.
 */
export async function getBudgetCodingQueue(supabase: Client, budgetId: string) {
  return supabase.from("v_budget_coding_queue").select("*").eq("budget_id", budgetId);
}

// ────────────────────────────────────────────────────────────
// LINES
// ────────────────────────────────────────────────────────────

/** Fields a person may set on a line. Totals, coding status, budget and creator are the database's. */
export const EDITABLE_LINE_FIELDS = [
  "section_id",
  "kind",
  "name",
  "category_id",
  "amount_cents",
  "frequency",
  "multiplier",
  "uses_driver",
  "sort",
  "notes",
] as const;

export type BudgetLineEditable = {
  section_id: string;
  kind: BudgetLineKind;
  name: string;
  /** Omit for "Not sure yet". */
  category_id?: string | null;
  amount_cents: number;
  frequency?: number;
  multiplier?: number;
  uses_driver?: boolean;
  sort?: number;
  notes?: string | null;
};

export type AddBudgetLineInput = BudgetLineEditable & { budget_id: string };
export type UpdateBudgetLineInput = Partial<BudgetLineEditable>;

/** Keeps only the fields in EDITABLE_LINE_FIELDS (drops anything else a request body carried). */
export function pickEditableLineFields(input: Record<string, unknown>): UpdateBudgetLineInput {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_LINE_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out as UpdateBudgetLineInput;
}

export async function addLine(supabase: Client, input: AddBudgetLineInput) {
  return supabase
    .from("budget_lines")
    .insert({ budget_id: input.budget_id, ...pickEditableLineFields(input) })
    .select()
    .single();
}

export async function updateLine(supabase: Client, lineId: string, patch: UpdateBudgetLineInput) {
  return supabase
    .from("budget_lines")
    .update(pickEditableLineFields(patch))
    .eq("id", lineId)
    .select()
    .single();
}

/** Lines are never deleted: archiving hides them from the budget and the views. */
export async function archiveLine(supabase: Client, lineId: string) {
  return supabase
    .from("budget_lines")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", lineId)
    .is("archived_at", null)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// CODING — explicit mirror ids. Never matched by ministry name.
// ────────────────────────────────────────────────────────────

/**
 * The Xero tracking option already stored on a finance project.
 * Look up by project id only. Do not search finance_projects by name.
 */
export async function getFinanceProjectTrackingOption(supabase: Client, projectId: string) {
  return supabase
    .from("finance_projects")
    .select("id, org_id, xero_tracking_option_id")
    .eq("id", projectId)
    .maybeSingle();
}

export type CodeBudgetLineInput = {
  lineId: string;
  /** The budget org's xero_region. The database rejects any other region. */
  orgRegion: XeroOrgRegion;
  accountId: string | null;
  trackingOption1Id?: string | null;
  trackingOption2Id?: string | null;
};

/** Upsert the single coding row for a line. One org only. */
export async function codeBudgetLine(supabase: Client, input: CodeBudgetLineInput) {
  return supabase
    .from("budget_line_coding")
    .upsert(
      {
        line_id: input.lineId,
        org_region: input.orgRegion,
        account_id: input.accountId,
        tracking_option_1_id: input.trackingOption1Id ?? null,
        tracking_option_2_id: input.trackingOption2Id ?? null,
      },
      { onConflict: "line_id" }
    )
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// EXPENSES — manual tracker, parent budget currency, no outreach rows
// ────────────────────────────────────────────────────────────

export const EDITABLE_EXPENSE_FIELDS = [
  "line_id",
  "expense_date",
  "vendor",
  "description",
  "amount_cents",
  "reference",
  "notes",
] as const;

export type BudgetExpenseEditable = {
  line_id?: string | null;
  expense_date: string;
  vendor?: string | null;
  description: string;
  amount_cents: number;
  reference?: string | null;
  notes?: string | null;
};

export type AddBudgetExpenseInput = BudgetExpenseEditable & { budget_id: string };

export function pickEditableExpenseFields(input: Record<string, unknown>): Partial<BudgetExpenseEditable> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_EXPENSE_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out as Partial<BudgetExpenseEditable>;
}

/** Records spend (positive) or a refund (negative) in the budget's currency. */
export async function addBudgetExpense(supabase: Client, input: AddBudgetExpenseInput) {
  return supabase
    .from("budget_expenses")
    .insert({ budget_id: input.budget_id, ...pickEditableExpenseFields(input) })
    .select()
    .single();
}

export async function updateBudgetExpense(
  supabase: Client,
  expenseId: string,
  patch: Partial<BudgetExpenseEditable>
) {
  return supabase
    .from("budget_expenses")
    .update(pickEditableExpenseFields(patch))
    .eq("id", expenseId)
    .select()
    .single();
}

/** Expenses are archived, not deleted, so spend history stays in the audit log. */
export async function archiveBudgetExpense(supabase: Client, expenseId: string) {
  return supabase
    .from("budget_expenses")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", expenseId)
    .is("archived_at", null)
    .select()
    .single();
}
