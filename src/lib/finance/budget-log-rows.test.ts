import { describe, expect, it } from "vitest";
import { repaymentLogRow, xeroSpendLogRow } from "./budget-log-rows";

describe("xeroSpendLogRow", () => {
  const base = {
    budgetId: "b1",
    lineId: "l1",
    outreachExpenseId: "e1",
    receiptDraftId: "d1",
    purchaserUserId: "u1",
    bookAmount: 40,
    bookCurrency: "USD" as const,
    budgetCurrency: "USD" as const,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    spentOn: "2026-11-06",
    description: "  Food  ",
    hasReceipt: true,
    xeroBankTransactionId: "bt",
    xeroStatus: "written",
    confirmedAt: "2026-11-06T00:00:00.000Z",
  };

  it("writes line_id and budget-currency cents, with no org_key or currency", () => {
    const row = xeroSpendLogRow(base);
    expect(row).toEqual({
      budget_id: "b1",
      line_id: "l1",
      outreach_expense_id: "e1",
      receipt_draft_id: "d1",
      purchaser_user_id: "u1",
      amount_cents: 4000,
      spent_on: "2026-11-06",
      description: "Food",
      has_receipt: true,
      xero_bank_transaction_id: "bt",
      xero_status: "written",
      confirmed_at: "2026-11-06T00:00:00.000Z",
    });
    expect(row && "currency" in row).toBe(false);
    expect(row && "org_key" in row).toBe(false);
    expect(row && "budget_line_id" in row).toBe(false);
  });

  it("skips when there is no budget or the book currency is not the budget's", () => {
    expect(xeroSpendLogRow({ ...base, budgetId: null })).toBeNull();
    expect(xeroSpendLogRow({ ...base, bookCurrency: "ZAR", bookAmount: 720 })).toBeNull();
    expect(xeroSpendLogRow({ ...base, bookAmount: 0 })).toBeNull();
    expect(xeroSpendLogRow({ ...base, spentOn: "2025-12-31" })).toBeNull();
    expect(xeroSpendLogRow({ ...base, spentOn: "2027-01-01" })).toBeNull();
    expect(xeroSpendLogRow({ ...base, periodStart: null, periodEnd: null })).toBeNull();
  });
});

describe("repaymentLogRow", () => {
  it("requires a budget whose currency is the confirmed currency, and uses line_id", () => {
    const row = repaymentLogRow({
      budgetId: "b1",
      lineId: "l1",
      hubUserId: "u1",
      slackUserId: "U1",
      teamId: "t1",
      amountCents: 18000,
      amountCurrency: "ZAR",
      budgetCurrency: "ZAR",
      description: " taxi ",
      confirmedAt: "2026-11-06T00:00:00.000Z",
    });
    expect(row?.line_id).toBe("l1");
    expect(row?.amount_cents).toBe(18000);
    expect(row?.reason).toBe("no_receipt");
    expect(row && "currency" in row).toBe(false);
    expect(repaymentLogRow({ ...{
      budgetId: "b1",
      lineId: null,
      hubUserId: null,
      slackUserId: "U1",
      teamId: "t1",
      amountCents: 4000,
      amountCurrency: "USD",
      budgetCurrency: "ZAR",
      description: "coffee",
      confirmedAt: "2026-11-06T00:00:00.000Z",
    } })).toBeNull();
    expect(repaymentLogRow({
      budgetId: null,
      lineId: null,
      hubUserId: null,
      slackUserId: "U1",
      teamId: "t1",
      amountCents: 18000,
      amountCurrency: "ZAR",
      budgetCurrency: "ZAR",
      description: "taxi",
      confirmedAt: "2026-11-06T00:00:00.000Z",
    })).toBeNull();
  });
});
