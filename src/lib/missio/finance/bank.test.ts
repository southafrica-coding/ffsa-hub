import { describe, expect, it } from "vitest";
import {
  bankAccountLabel,
  bankAmounts,
  isSnapScanPayout,
  receiptFromBankTransaction,
  receiptFromPayment,
  xeroDocDate,
} from "./bank";

// Made-up Xero documents, shaped like the API's JSON. Never sent anywhere.
const ACC = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

function bt(over: Record<string, unknown> = {}) {
  return {
    Type: "RECEIVE",
    Status: "AUTHORISED",
    BankAccount: { AccountID: ACC },
    DateString: "2026-08-14T00:00:00",
    Total: 1500.5,
    Reference: "Tithe",
    Contact: { Name: "A Giver" },
    LineItems: [{ Description: "Sunday giving" }],
    ...over,
  };
}

function pay(over: Record<string, unknown> = {}) {
  return {
    PaymentType: "ACCRECPAYMENT",
    Status: "AUTHORISED",
    Account: { AccountID: ACC },
    Date: "/Date(1790294400000+0000)/", // 2026-09-25
    Amount: 200,
    Reference: "INV-1",
    Invoice: { Contact: { Name: "Camp parent" }, InvoiceNumber: "INV-1" },
    ...over,
  };
}

describe("Xero documents → receipts", () => {
  it("takes Receive Money into the Missio account", () => {
    expect(receiptFromBankTransaction(bt(), ACC)).toEqual({
      date: "2026-08-14",
      cents: 150050,
      text: "Tithe · A Giver · Sunday giving",
      kind: "bank-transaction",
    });
    expect(receiptFromBankTransaction(bt({ Type: "RECEIVE-OVERPAYMENT" }), ACC)).not.toBeNull();
    expect(receiptFromBankTransaction(bt({ Type: "RECEIVE-PREPAYMENT" }), ACC)).not.toBeNull();
  });

  it("leaves out money paid out, other accounts, and deleted or voided lines", () => {
    expect(receiptFromBankTransaction(bt({ Type: "SPEND" }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ Type: "SPEND-TRANSFER" }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ Type: "RECEIVE-TRANSFER" }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ Status: "DELETED" }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ Status: "VOIDED" }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ BankAccount: { AccountID: OTHER } }), ACC)).toBeNull();
    expect(receiptFromBankTransaction(bt({ Total: 0 }), ACC)).toBeNull();
  });

  it("takes customer payments into the account, not supplier payments or refunds", () => {
    expect(receiptFromPayment(pay(), ACC)).toMatchObject({ date: "2026-09-25", cents: 20000, kind: "payment" });
    expect(receiptFromPayment(pay({ PaymentType: "ACCPAYPAYMENT" }), ACC)).toBeNull();
    expect(receiptFromPayment(pay({ PaymentType: "ARCREDITPAYMENT" }), ACC)).toBeNull();
    expect(receiptFromPayment(pay({ Status: "DELETED" }), ACC)).toBeNull();
    expect(receiptFromPayment(pay({ Account: { AccountID: OTHER } }), ACC)).toBeNull();
  });

  it("reads both of Xero's date forms", () => {
    expect(xeroDocDate({ DateString: "2026-11-16T00:00:00" })).toBe("2026-11-16");
    expect(xeroDocDate({ Date: "/Date(1794787200000+0000)/" })).toBe("2026-11-16");
    expect(xeroDocDate({})).toBeNull();
  });
});

describe("SnapScan split", () => {
  it("finds SnapScan payouts by reference, contact or description", () => {
    expect(isSnapScanPayout({ text: "SNAPSCAN PAYOUT 12345" })).toBe(true);
    expect(isSnapScanPayout({ text: "Snap Scan" })).toBe(true);
    expect(isSnapScanPayout({ text: "Tithe · A Giver" })).toBe(false);
  });

  it("puts SnapScan on its bank date and everything else under EFT & other", () => {
    const receipts = [
      receiptFromBankTransaction(bt({ Reference: "SnapScan payout", DateString: "2026-11-02T00:00:00", Total: 875.5 }), ACC)!,
      receiptFromBankTransaction(bt(), ACC)!,
      receiptFromPayment(pay(), ACC)!,
    ];
    expect(bankAmounts(receipts)).toEqual([
      { source: "snapscan", date: "2026-11-02", cents: 87550 },
      { source: "bank", date: "2026-08-14", cents: 150050 },
      { source: "bank", date: "2026-09-25", cents: 20000 },
    ]);
  });
});

describe("bank account label", () => {
  it("keeps the account number out of the page", () => {
    expect(bankAccountLabel("MISSIO - 12345678901", "5110")).toBe("MISSIO (account 5110)");
    expect(bankAccountLabel("Missio cheque", null)).toBe("Missio cheque");
  });
});
