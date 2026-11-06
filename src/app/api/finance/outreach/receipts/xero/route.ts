/**
 * POST /api/finance/outreach/receipts/xero  { draftId }
 *
 * Retries the Xero spend for a receipt that was already confirmed (the
 * draft status is logged). It does not confirm a draft, and it does not
 * post a second time when a bank transaction id is already stored.
 */

import { NextResponse } from "next/server";
import { writeConfirmedSpend } from "@/lib/finance/record-xero-spend";
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
    local_currency?: string;
    zar_confirmed?: boolean;
    budget_id?: string | null;
    budget_line_id?: string | null;
    budget_line_label?: string | null;
  };

  let zarConfirmed = proposal.local_currency === "ZAR" || Boolean(proposal.zar_confirmed);
  let amountZar = Number(proposal.zar_amount);
  let date = proposal.expense_date ?? "";
  if (draft.expense_id) {
    const { data: expense } = await admin
      .from("outreach_expenses")
      .select("zar_amount, zar_confirmed, local_currency, expense_date")
      .eq("id", draft.expense_id)
      .maybeSingle();
    if (expense) {
      zarConfirmed = expense.local_currency === "ZAR" || Boolean(expense.zar_confirmed);
      amountZar = Number(expense.zar_amount);
      date = expense.expense_date ?? date;
    }
  }

  const result = await writeConfirmedSpend(admin, {
    draftId,
    expenseId: draft.expense_id ?? null,
    hubUserId: draft.hub_user_id ?? null,
    confirmed: true,
    hasReceipt: Boolean(draft.storage_path),
    repayment: false,
    zarConfirmed,
    amountZar,
    date,
    description: proposal.budget_line_label || proposal.description || "Receipt",
    vendor: proposal.vendor ?? null,
    budgetId: proposal.budget_id ?? null,
    budgetLineId: proposal.budget_line_id ?? null,
    region: "za",
    proposal,
  });

  return NextResponse.json({
    status: result.status,
    bankTransactionId: result.bankTransactionId,
  });
}
