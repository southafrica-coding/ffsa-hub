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
  /** Inclusive fiscal-period bounds. #513 rejects a date outside them. */
  periodStart: string | null;
  periodEnd: string | null;
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
  const spentOn = args.spentOn.slice(0, 10);
  const periodStart = args.periodStart?.slice(0, 10) ?? "";
  const periodEnd = args.periodEnd?.slice(0, 10) ?? "";
  // 301 rejects a date outside the budget period. No row, including an update.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || !periodStart || !periodEnd) return null;
  if (spentOn < periodStart || spentOn > periodEnd) return null;
  if (!description) return null;
  const amountCents = Math.round(args.bookAmount * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  return {
    budget_id: args.budgetId,
    line_id: args.lineId,
    outreach_expense_id: args.outreachExpenseId,
    receipt_draft_id: args.receiptDraftId,
    purchaser_user_id: args.purchaserUserId,
    amount_cents: amountCents,
    spent_on: spentOn,
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
  /** #513 unique confirm key. A Slack message ts, or a receipt draft id when the click has no ts. */
  slack_message_ts: string;
  team_id: string | null;
  amount_cents: number;
  description: string;
  reason: "no_receipt";
  confirmed_at: string;
};

/**
 * Confirm identity for budget_repayments.slack_message_ts.
 * The card's message ts wins. A receipt draft id is the token only when
 * the click has no ts. Same token is the same confirm. A new card is a new ts,
 * so two repayments can share amount and description.
 */
export function repaymentIdempotencyToken(args: {
  messageTs?: string | null;
  receiptDraftId?: string | null;
}): string | null {
  const ts = args.messageTs?.trim() ?? "";
  if (ts.length >= 1 && ts.length <= 64) return ts;
  const draft = args.receiptDraftId?.trim() ?? "";
  if (draft.length >= 1 && draft.length <= 64) return draft;
  return null;
}

export function repaymentLogRow(args: {
  budgetId: string | null;
  lineId: string | null;
  hubUserId: string | null;
  slackUserId: string;
  /** Must be that budget's outreach team. Null when the claim named no team. */
  teamId: string | null;
  amountCents: number;
  /** Currency the person confirmed. Compared to the budget, never written. */
  amountCurrency: string;
  budgetCurrency: BudgetCurrency | null;
  description: string;
  confirmedAt: string;
  /** Slack message ts, or a receipt draft id. Required. Not a currency and not a description. */
  idempotencyToken: string | null;
}): RepaymentLogRow | null {
  if (!args.budgetId || !args.budgetCurrency) return null;
  if (args.amountCurrency.toUpperCase() !== args.budgetCurrency) return null;
  const description = args.description.trim();
  const token = args.idempotencyToken?.trim() ?? "";
  if (!description || !args.slackUserId) return null;
  if (token.length < 1 || token.length > 64) return null;
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) return null;
  return {
    budget_id: args.budgetId,
    line_id: args.lineId,
    hub_user_id: args.hubUserId,
    slack_user_id: args.slackUserId,
    slack_message_ts: token,
    team_id: args.teamId,
    amount_cents: args.amountCents,
    description: description.slice(0, 500),
    reason: "no_receipt",
    confirmed_at: args.confirmedAt,
  };
}
