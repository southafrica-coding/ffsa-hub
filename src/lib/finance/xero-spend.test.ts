import { afterEach, describe, expect, it } from "vitest";
import { decideXeroSpend, type XeroSpendInput } from "./xero-spend";

function input(over: Partial<XeroSpendInput> = {}): XeroSpendInput {
  return {
    confirmed: true,
    hasReceipt: true,
    repayment: false,
    zarConfirmed: true,
    amountZar: 180.5,
    date: "2026-11-06",
    description: "Food — taxi to the venue",
    vendor: "Bolt",
    reference: "ffsa-draft-1",
    accountCode: "400",
    bankAccountCode: "090",
    tracking: [{ name: "Ministries", option: "Botswana" }],
    ...over,
  };
}

describe("decideXeroSpend", () => {
  afterEach(() => {
    delete process.env.XERO_SPEND_BANK_ACCOUNT_ZA;
  });

  it("builds one authorised spend only after confirm, with the budget line's account", () => {
    const decision = decideXeroSpend(input());
    expect(decision.write).toBe(true);
    if (!decision.write) return;
    expect(decision.payload).toMatchObject({
      Type: "SPEND",
      Status: "AUTHORISED",
      Contact: { Name: "Bolt" },
      Date: "2026-11-06",
      Reference: "ffsa-draft-1",
      BankAccount: { Code: "090" },
    });
    expect(decision.payload.LineItems[0]).toMatchObject({
      Description: "Food — taxi to the venue",
      UnitAmount: 180.5,
      AccountCode: "400",
      Tracking: [{ Name: "Ministries", Option: "Botswana" }],
    });
  });

  it("does not write before confirm, without a receipt, or when the purchaser repays", () => {
    expect(decideXeroSpend(input({ confirmed: false })).write).toBe(false);
    expect(decideXeroSpend(input({ hasReceipt: false }))).toMatchObject({ write: false, status: "no_receipt" });
    expect(decideXeroSpend(input({ repayment: true, hasReceipt: false }))).toMatchObject({
      write: false,
      status: "repayment",
    });
  });

  it("waits for the bank's rand and for an account code", () => {
    expect(decideXeroSpend(input({ zarConfirmed: false }))).toMatchObject({ status: "rand_not_confirmed" });
    expect(decideXeroSpend(input({ accountCode: null }))).toMatchObject({ status: "no_account" });
    expect(decideXeroSpend(input({ accountCode: "  " }))).toMatchObject({ status: "no_account" });
    expect(decideXeroSpend(input({ bankAccountCode: "" }))).toMatchObject({ status: "no_bank_account" });
  });

  it("omits tracking when the line has none", () => {
    const decision = decideXeroSpend(input({ tracking: [] }));
    expect(decision.write).toBe(true);
    if (!decision.write) return;
    expect(decision.payload.LineItems[0].Tracking).toBeUndefined();
  });
});
