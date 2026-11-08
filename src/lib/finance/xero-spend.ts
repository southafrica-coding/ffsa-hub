/**
 * A confirmed receipt may become one Xero spend-money transaction.
 * The decision is pure: callers POST only when `write` is true, and only
 * after the person has confirmed. A missing receipt is a repayment and
 * never reaches Xero.
 */

export type XeroTracking = { name: string; option: string };

export type XeroSpendInput = {
  /** The Slack Confirm tap, or a finance retry of a draft that is already logged. */
  confirmed: boolean;
  hasReceipt: boolean;
  /** No-receipt purchases are repaid by the purchaser. Never a Xero spend. */
  repayment: boolean;
  /** Foreign card payments wait until the bank's rand is confirmed. Cash does not. */
  zarConfirmed: boolean;
  /** Cash funded by an ATM pull is not posted again from the spend bank account. */
  paymentMethod: "cash" | "card" | "bank_transfer";
  amountZar: number;
  date: string;
  description: string;
  vendor: string | null;
  reference: string;
  accountCode: string | null;
  bankAccountCode: string | null;
  tracking: XeroTracking[];
};

export type XeroBankSpend = {
  Type: "SPEND";
  Status: "AUTHORISED";
  Contact: { Name: string };
  Date: string;
  Reference: string;
  LineItems: [
    {
      Description: string;
      Quantity: 1;
      UnitAmount: number;
      AccountCode: string;
      Tracking?: { Name: string; Option: string }[];
    },
  ];
  BankAccount: { Code: string };
};

export type XeroSpendSkip =
  | "not_confirmed"
  | "no_receipt"
  | "repayment"
  | "rand_not_confirmed"
  | "cash_not_posted"
  | "no_account"
  | "no_bank_account"
  | "bad_amount";

export type XeroSpendDecision =
  | { write: false; status: XeroSpendSkip }
  | { write: true; status: "ready"; payload: XeroBankSpend };

export function spendBankAccountCode(region: "za" | "us"): string | null {
  const raw = region === "us" ? process.env.XERO_SPEND_BANK_ACCOUNT_US : process.env.XERO_SPEND_BANK_ACCOUNT_ZA;
  const code = (raw ?? "").trim();
  return code || null;
}

export function decideXeroSpend(input: XeroSpendInput): XeroSpendDecision {
  if (!input.confirmed) return { write: false, status: "not_confirmed" };
  if (input.repayment) return { write: false, status: "repayment" };
  if (!input.hasReceipt) return { write: false, status: "no_receipt" };
  // The withdrawal already left the bank. Posting the cash purchase again
  // would count the same money twice. A clearing account is not guessed.
  if (input.paymentMethod === "cash") return { write: false, status: "cash_not_posted" };
  if (!input.zarConfirmed) return { write: false, status: "rand_not_confirmed" };
  if (!(input.amountZar > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { write: false, status: "bad_amount" };
  }
  const accountCode = (input.accountCode ?? "").trim();
  if (!accountCode) return { write: false, status: "no_account" };
  const bank = (input.bankAccountCode ?? "").trim();
  if (!bank) return { write: false, status: "no_bank_account" };

  const tracking = input.tracking
    .filter((t) => t.name.trim() && t.option.trim())
    .map((t) => ({ Name: t.name.trim(), Option: t.option.trim() }));
  const line: XeroBankSpend["LineItems"][number] = {
    Description: input.description.trim().slice(0, 4000) || "Receipt",
    Quantity: 1,
    UnitAmount: Math.round(input.amountZar * 100) / 100,
    AccountCode: accountCode,
  };
  if (tracking.length) line.Tracking = tracking;

  return {
    write: true,
    status: "ready",
    payload: {
      Type: "SPEND",
      Status: "AUTHORISED",
      Contact: { Name: (input.vendor ?? "").trim().slice(0, 255) || "Outreach purchase" },
      Date: input.date,
      Reference: input.reference.slice(0, 255),
      LineItems: [line],
      BankAccount: { Code: bank },
    },
  };
}

/** One sentence for the Slack card after confirm. */
export function xeroResultSentence(status: string): string {
  switch (status) {
    case "written":
    case "already_written":
      return "Sent to Xero.";
    case "rand_not_confirmed":
      return "Not sent to Xero yet — a card payment waits until the bank confirms the rand.";
    case "cash_not_posted":
      return "Not sent to Xero. Cash from a withdrawal is already out of the bank, so this purchase is not posted again.";
    case "outside_period":
      return "Not sent to Xero — the date is outside that budget's period.";
    case "org_not_south_africa":
      return "Not sent to Xero — that budget is not on the active South Africa organisation.";
    case "unapproved_budget":
      return "Not sent to Xero — that budget is not approved yet.";
    case "preview_blocked":
      return "Not sent to Xero — a preview deployment cannot write to Xero.";
    case "bank_proof_only":
      return "A bank notification is not the shop receipt, so nothing was posted from this screenshot.";
    case "no_account":
      return "Not sent to Xero — this budget line has no account yet.";
    case "no_bank_account":
      return "Not sent to Xero — the spend bank account isn't set.";
    case "repayment":
    case "no_receipt":
      return "Not sent to Xero. No receipt, so the purchaser repays this.";
    case "not_confirmed":
      return "Not sent to Xero — it hasn't been confirmed.";
    case "failed":
      return "Saved here. Xero did not take it — finance can retry once it's confirmed.";
    default:
      return "Not sent to Xero.";
  }
}
