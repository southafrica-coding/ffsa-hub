import { describe, expect, it } from "vitest";
import { confirmedReceiptDraft, retryXeroMessage } from "./receipt-xero-retry";

describe("confirmedReceiptDraft", () => {
  it("labels a logged receipt and skips a cash pull", () => {
    expect(
      confirmedReceiptDraft({
        id: "d1",
        expense_id: "e1",
        file_name: "shop.jpg",
        proposal: { budget_line_label: "Food — Groceries", description: "Milk" },
      })
    ).toEqual({ id: "d1", expenseId: "e1", label: "Food — Groceries", fileName: "shop.jpg" });
    expect(confirmedReceiptDraft({ id: "d2", kind: "cash_pull", file_name: "cash.jpg" })).toBeNull();
  });
});

describe("retryXeroMessage", () => {
  it("says a repeat send is not a second spend", () => {
    expect(retryXeroMessage(200, { status: "already_written", bankTransactionId: "bt-1" })).toMatch(/Nothing new was created/);
    expect(retryXeroMessage(200, { status: "written", bankTransactionId: "bt-1" })).toMatch(/not a second spend/);
  });

  it("explains a 409 in plain language", () => {
    expect(retryXeroMessage(409, { error: "Confirm the receipt before sending it to Xero." })).toMatch(/isn't confirmed/);
  });

  it("does not claim success when the route is missing", () => {
    expect(retryXeroMessage(404, {})).toMatch(/isn't available/);
  });
});
