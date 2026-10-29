import type { BudgetLineKind } from "@/lib/finance/budget-lines";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// Budgets (migrations 277–279). Pure data access: every call runs as the
// signed-in user, so RLS decides what they can see and change. Totals,
// coding status and the copied Xero coding are set by database triggers —
// nothing here sends them.

export type BudgetOwnerKind = "staff_ministry" | "ministry_subcategory" | "program" | "event";

// Explicit FK names: budget_lines links budgets to budget_sections, so a
// bare embed would be ambiguous to PostgREST.
const BUDGET_DETAIL_SELECT = `
  *,
  fiscal_periods!budgets_period_id_fkey(id, label, kind, start_date, end_date),
  budget_sections!budget_sections_budget_id_fkey(id, key, label, sort, holds_lines),
  budget_lines!budget_lines_budget_id_fkey(
    *,
    budget_categories!budget_lines_category_id_fkey(id, key, name, group_name, icon)
  )
`;

// ────────────────────────────────────────────────────────────
// TEMPLATES
// ────────────────────────────────────────────────────────────

export async function getBudgetTemplates(supabase: Client) {
  return supabase
    .from("budget_templates")
    .select("*, budget_template_sections(id, key, label, help_text, sort, holds_lines)")
    .eq("is_active", true)
    .order("name");
}

// ────────────────────────────────────────────────────────────
// BUDGETS
// ────────────────────────────────────────────────────────────

export type CreateBudgetInput = {
  templateId: string;
  ownerKind: BudgetOwnerKind;
  ownerId: string;
  periodId: string;
  name: string;
  currency?: "ZAR" | "USD";
  driverLabel?: string;
  driverValue?: number;
};

/** Creates an EMPTY budget (sections, zero lines). Returns `{ data: budgetId }`. */
export async function createBudgetFromTemplate(supabase: Client, input: CreateBudgetInput) {
  return supabase.rpc("create_budget_from_template", {
    p_template_id: input.templateId,
    p_owner_kind: input.ownerKind,
    p_owner_id: input.ownerId,
    p_period_id: input.periodId,
    p_name: input.name,
    p_currency: input.currency ?? null,
    p_driver_label: input.driverLabel ?? null,
    p_driver_value: input.driverValue ?? null,
  });
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
