// ────────────────────────────────────────────────────────────
// Missio Finance — money into the Missio bank account, from Xero
// ────────────────────────────────────────────────────────────
// Pure: takes the documents Xero returns (read-only GETs in
// listXeroBankReceipts, src/services/xero.ts) and turns them into dated
// receipts, then into the report's "EFT & other bank" and "SnapScan" amounts.
//
// Rules, as in the 19 Nov 2026 report:
//   * Income is money RECEIVED into the Missio bank account and booked in
//     Xero: Receive Money bank transactions (RECEIVE, RECEIVE-OVERPAYMENT,
//     RECEIVE-PREPAYMENT) and customer invoice payments (ACCRECPAYMENT).
//     Bank statement lines nobody has reconciled yet aren't in Xero's
//     transactions, so they aren't counted.
//   * Deleted / voided documents are left out. Spend Money, supplier
//     payments, refunds and transfers between FFSA's own accounts are not
//     income and are never subtracted or added.
//   * SnapScan is split out of those receipts by its payout reference (the
//     words "SnapScan" in the reference, contact or line description) and
//     counted on the day it landed in the bank. A payout SnapScan has made but
//     the bank hasn't received isn't in Xero, so it isn't counted.
//   * EFT & other = every other receipt.

import type { SourceAmount } from "./report";

export interface BankReceipt {
  /** YYYY-MM-DD, the bank date in Xero. */
  date: string;
  cents: number;
  /** Reference, contact name and line descriptions, for the SnapScan split. */
  text: string;
  kind: "bank-transaction" | "payment";
}

type Doc = Record<string, unknown>;

const RECEIVE_TYPES = new Set(["RECEIVE", "RECEIVE-OVERPAYMENT", "RECEIVE-PREPAYMENT"]);

/** Matches "SnapScan", "SNAPSCAN", "Snap Scan" in a payout reference. */
export const SNAPSCAN_PATTERN = /snap\s*scan/i;

/** Xero's "/Date(1735689600000+0000)/" or "2026-08-03T00:00:00" → "2026-08-03". */
export function xeroDocDate(doc: Doc): string | null {
  const ds = doc.DateString;
  if (typeof ds === "string" && /^\d{4}-\d{2}-\d{2}/.test(ds)) return ds.slice(0, 10);
  const d = doc.Date;
  if (typeof d === "string") {
    const m = d.match(/\/Date\((-?\d+)/);
    if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  }
  return null;
}

/** Rand to cents without float drift: 1234.5 → 123450. */
export function randToCents(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function textOf(...parts: unknown[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" · ");
}

/** A Receive Money transaction into `accountId`, or null when it isn't one. */
export function receiptFromBankTransaction(doc: Doc, accountId: string): BankReceipt | null {
  if (!RECEIVE_TYPES.has(String(doc.Type ?? ""))) return null;
  if (String(doc.Status ?? "") !== "AUTHORISED") return null;
  const account = doc.BankAccount as { AccountID?: string } | undefined;
  if (!account?.AccountID || account.AccountID.toLowerCase() !== accountId.toLowerCase()) return null;
  const date = xeroDocDate(doc);
  const cents = randToCents(doc.Total);
  if (!date || cents === null || cents <= 0) return null;
  const contact = (doc.Contact as { Name?: string } | undefined)?.Name;
  const lines = ((doc.LineItems as Doc[] | undefined) ?? []).map((l) => l.Description);
  return { date, cents, text: textOf(doc.Reference, contact, ...lines), kind: "bank-transaction" };
}

/** A customer payment received into `accountId`, or null when it isn't one. */
export function receiptFromPayment(doc: Doc, accountId: string): BankReceipt | null {
  if (String(doc.PaymentType ?? "") !== "ACCRECPAYMENT") return null;
  if (String(doc.Status ?? "") !== "AUTHORISED") return null;
  const account = doc.Account as { AccountID?: string } | undefined;
  if (!account?.AccountID || account.AccountID.toLowerCase() !== accountId.toLowerCase()) return null;
  const date = xeroDocDate(doc);
  const cents = randToCents(doc.Amount);
  if (!date || cents === null || cents <= 0) return null;
  const invoice = doc.Invoice as { Contact?: { Name?: string }; InvoiceNumber?: string } | undefined;
  return { date, cents, text: textOf(doc.Reference, invoice?.Contact?.Name, invoice?.InvoiceNumber), kind: "payment" };
}

export function isSnapScanPayout(receipt: Pick<BankReceipt, "text">): boolean {
  return SNAPSCAN_PATTERN.test(receipt.text);
}

/** Receipts → the report's bank and SnapScan amounts, each on its bank date. */
export function bankAmounts(receipts: readonly BankReceipt[]): SourceAmount[] {
  return receipts.map((r) => ({
    source: isSnapScanPayout(r) ? "snapscan" : "bank",
    date: r.date,
    cents: r.cents,
  }));
}

/**
 * The bank account's name for the page, without the account number: the
 * Xero name is "<NAME> - <number>", and the number stays out of the browser.
 */
export function bankAccountLabel(name: string, code: string | null): string {
  const bare = name.replace(/\s*[-–]\s*[\d\s]{6,}$/, "").trim() || "Bank account";
  return code ? `${bare} (account ${code})` : bare;
}
