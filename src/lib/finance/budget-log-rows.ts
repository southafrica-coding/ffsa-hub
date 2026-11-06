/**
 * Rows for Hub Data's draft #513 (migrations 300–301, not applied here).
 *
 * budget_xero_spends and budget_repayments have no currency column and no
 * org_key. Money is cents of the parent budget's currency. The line column
 * is line_id, not budget_line_id. A missing budget means no row.
 */

export type BudgetCurrency = "ZAR" | "USD";

export type XeroSpendLogRow = {
  budget_id: string;
  line_id: string | null;
  outreach_expense_id: string | null;
  receipt_draft_id: string;
  purchaser_user_id: string | null;
  amount_cents: number;
  spent_on: string;
  description: string;
  has_receipt: boolean;
  xero_bank_transaction_id: string | null;
  xero_status: string;
  confirmed_at: string;
};

export function xeroSpendLogRow(args: {
  budgetId: string | null;
  lineId: string | null;
  outreachExpenseId: string | null;
  receiptDraftId: string;
  purchaserUserId: string | null;
  /** Major units already in the budget's currency. Dollars for a USD budget, not a rand conversion. */
  bookAmount: number;
  bookCurrency: BudgetCurrency;
  budgetCurrency: BudgetCurrency | null;
  spentOn: string;
  description: string;
  hasReceipt: boolean;
  xeroBankTransactionId: string | null;
  xeroStatus: string;
  confirmedAt: string;
}): XeroSpendLogRow | null {
  if (!args.budgetId || !args.budgetCurrency) return null;
  if (args.bookCurrency !== args.budgetCurrency) return null;
  const description = args.description.trim();
  if (!description || !args.spentOn) return null;
  const amountCents = Math.round(args.bookAmount * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  return {
    budget_id: args.budgetId,
    line_id: args.lineId,
    outreach_expense_id: args.outreachExpenseId,
    receipt_draft_id: args.receiptDraftId,
    purchaser_user_id: args.purchaserUserId,
    amount_cents: amountCents,
    spent_on: args.spentOn,
    description: description.slice(0, 4000),
    has_receipt: args.hasReceipt,
    xero_bank_transaction_id: args.xeroBankTransactionId,
    xero_status: args.xeroStatus.trim().slice(0, 64) || "failed",
    confirmed_at: args.confirmedAt,
  };
}

export type RepaymentLogRow = {
  budget_id: string;
  line_id: string | null;
  hub_user_id: string | null;
  slack_user_id: string;
  team_id: string | null;
  amount_cents: number;
  description: string;
  reason: "no_receipt";
  confirmed_at: string;
};

export function repaymentLogRow(args: {
  budgetId: string | null;
  lineId: string | null;
  hubUserId: string | null;
  slackUserId: string;
  /** Must be that budget's outreach team. Null when the claim named no team. */
  teamId: string | null;
  amountCents: number;
  /** Currency the person confirmed. Stored only if it is the budget's currency. */
  amountCurrency: string;
  budgetCurrency: BudgetCurrency | null;
  description: string;
  confirmedAt: string;
}): RepaymentLogRow | null {
  if (!args.budgetId || !args.budgetCurrency) return null;
  if (args.amountCurrency.toUpperCase() !== args.budgetCurrency) return null;
  const description = args.description.trim();
  if (!description || !args.slackUserId) return null;
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) return null;
  return {
    budget_id: args.budgetId,
    line_id: args.lineId,
    hub_user_id: args.hubUserId,
    slack_user_id: args.slackUserId,
    team_id: args.teamId,
    amount_cents: args.amountCents,
    description: description.slice(0, 500),
    reason: "no_receipt",
    confirmed_at: args.confirmedAt,
  };
}
