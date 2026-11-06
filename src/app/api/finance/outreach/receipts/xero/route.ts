/**
 * POST /api/finance/outreach/receipts/xero  { draftId }
 *
 * Retries the Xero spend for a receipt that was already confirmed (the
 * draft status is logged). It does not confirm a draft, and it does not
 * post a second time when a bank transaction id is already stored.
 */

import { NextResponse } from "next/server";
import { writeConfirmedSpend } from "@/lib/finance/record-xero-spend";
import { xeroPreviewWriteBlock } from "@/lib/finance/xero-preview-guard";
import { xeroBook, type BudgetOrgKey } from "@/lib/finance/team-budget-pick";
import { canEditFinanceProjects } from "@/lib/finance/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canEditFinanceProjects(supabase, user.id))) {
    return NextResponse.json({ error: "You don't have permission to send a receipt to Xero" }, { status: 403 });
  }

  let body: { draftId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

  const blocked = xeroPreviewWriteBlock();
  if (blocked) return NextResponse.json(blocked, { status: 403 });

  // Service role, and these columns (zar_confirmed, draft kind) are ahead of the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: draft, error } = await admin.from("outreach_receipt_drafts").select("*").eq("id", draftId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (draft.status !== "logged" || draft.kind === "cash_pull") {
    return NextResponse.json({ error: "Confirm the receipt before sending it to Xero." }, { status: 409 });
  }

  const proposal = (draft.proposal ?? {}) as Record<string, unknown> & {
    vendor?: string | null;
    description?: string;
    expense_date?: string;
    zar_amount?: number;
    zar_confirmed?: boolean;
    budget_id?: string | null;
    budget_line_id?: string | null;
    budget_line_label?: string | null;
    budget_org_key?: BudgetOrgKey | null;
    budget_status?: string | null;
    budget_period_start?: string | null;
    budget_period_end?: string | null;
    payment_method?: "cash" | "card" | "bank_transfer";
    local_amount?: number | null;
    local_currency?: string | null;
  };

  const org: BudgetOrgKey | null =
    proposal.budget_org_key === "usa" || proposal.budget_org_key === "npc" ? proposal.budget_org_key : null;
  let localCurrency = proposal.local_currency ?? "ZAR";
  const localAmount = proposal.local_amount ?? null;
  let zarAmount = Number(proposal.zar_amount);
  let zarConfirmed = (proposal.local_currency ?? "").toUpperCase() === "ZAR" || Boolean(proposal.zar_confirmed);
  let date = proposal.expense_date ?? "";
  // The saved expense is the rand book. A USA budget keeps the dollar slip instead.
  if (draft.expense_id && org !== "usa") {
    const { data: expense } = await admin
      .from("outreach_expenses")
      .select("zar_amount, zar_confirmed, local_currency, expense_date")
      .eq("id", draft.expense_id)
      .maybeSingle();
    if (expense) {
      localCurrency = expense.local_currency ?? localCurrency;
      zarAmount = Number(expense.zar_amount);
      zarConfirmed = expense.local_currency === "ZAR" || Boolean(expense.zar_confirmed);
      date = expense.expense_date ?? date;
    }
  }

  const book = xeroBook(org, { localCurrency, localAmount, zarAmount, zarConfirmed });
  const result = await writeConfirmedSpend(admin, {
    draftId,
    expenseId: draft.expense_id ?? null,
    hubUserId: draft.hub_user_id ?? null,
    confirmed: true,
    hasReceipt: Boolean(draft.storage_path),
    repayment: false,
    zarConfirmed: book.zarConfirmed,
    amountZar: book.amount,
    date,
    description: proposal.budget_line_label || proposal.description || "Receipt",
    vendor: proposal.vendor ?? null,
    budgetId: proposal.budget_id ?? null,
    budgetLineId: proposal.budget_line_id ?? null,
    orgKey: org,
    currency: book.currency,
    region: book.region,
    paymentMethod: proposal.payment_method === "card" || proposal.payment_method === "bank_transfer" ? proposal.payment_method : "cash",
    budgetStatus: proposal.budget_status ?? null,
    periodStart: proposal.budget_period_start ?? null,
    periodEnd: proposal.budget_period_end ?? null,
    proposal,
  });

  return NextResponse.json({
    status: result.status,
    bankTransactionId: result.bankTransactionId,
  });
}
