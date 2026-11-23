// ────────────────────────────────────────────────────────────
// Missio Finance — gathers the report's inputs on the server
// ────────────────────────────────────────────────────────────
// Bank and SnapScan: read-only from Xero (SA organisation, Missio's bank
// account), via the service role, because xero_accounts and xero_tokens are
// finance-only under RLS. Only month totals leave the server; no transaction,
// contact name, reference or account number reaches the browser.
//
// Cash and FundraiseUp: missio_finance_entries (migration 394) through the
// pastor's own client, so RLS decides. Until 394 is applied those two show
// an empty state and the form explains why.

import { bankAccountLabel, bankAmounts, receiptFromBankTransaction, receiptFromPayment, type BankReceipt } from "./bank";
import { buildIncomeReport, formatRate, type IncomeReport, type SourceAmount } from "./report";
import type { MissioFinanceEntryRow } from "@/services/missio-finance";
import type { XeroBankReceiptsResult } from "@/services/xero";

export type BankState = "ok" | "not_connected" | "needs_scope" | "account_unconfirmed" | "error";
export type EntriesState = "ok" | "not_installed" | "error";

export interface FinanceEntryView {
  source: "cash" | "fundraiseup";
  /** YYYY-MM */
  month: string;
  zarCents: number;
  usdCents: number | null;
  /** Rand per dollar, e.g. "18.25". */
  rate: string | null;
  rateNote: string | null;
  note: string | null;
  updatedAt: string;
}

export interface MissioFinanceResponse {
  report: IncomeReport;
  bank: { state: BankState; message: string | null; accountLabel: string | null };
  entries: { state: EntriesState; message: string | null; rows: FinanceEntryView[] };
}

export interface BankAccountRow {
  xero_account_id: string;
  name: string;
  code: string | null;
}

export type ResolvedAccount =
  | { ok: true; account: BankAccountRow }
  | { ok: false; state: "account_unconfirmed" | "error"; message: string };

/**
 * Missio's bank account in the SA Xero file. MISSIO_XERO_BANK_ACCOUNT_ID wins
 * when set; otherwise exactly one active bank account whose name starts with
 * "MISSIO" (seen in the mirror on 23 Nov 2026: code 5110). None or several →
 * Jack confirms which, and the bank figures stay empty meanwhile.
 */
export function pickMissioBankAccount(rows: readonly BankAccountRow[], configuredId?: string | null): ResolvedAccount {
  const wanted = configuredId?.trim();
  if (wanted) {
    const hit = rows.find((r) => r.xero_account_id.toLowerCase() === wanted.toLowerCase());
    return hit
      ? { ok: true, account: hit }
      : { ok: false, state: "account_unconfirmed", message: "The configured Missio bank account isn't among Xero's active bank accounts." };
  }
  const missio = rows.filter((r) => /^missio\b/i.test(r.name.trim()));
  if (missio.length === 1) return { ok: true, account: missio[0] };
  return {
    ok: false,
    state: "account_unconfirmed",
    message:
      missio.length === 0
        ? "No Xero bank account named Missio was found, so bank income can't be shown yet."
        : "More than one Xero bank account is named Missio. Finance needs to say which one this report uses.",
  };
}

export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /missio_finance_entries/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export function entryView(row: MissioFinanceEntryRow): FinanceEntryView | null {
  const month = typeof row.month === "string" ? row.month.slice(0, 7) : "";
  if (!/^\d{4}-\d{2}$/.test(month) || typeof row.zar_cents !== "number") return null;
  let rate: string | null = null;
  if (row.usd_zar_rate !== null && row.usd_zar_rate !== undefined) {
    const micros = Math.round(Number(row.usd_zar_rate) * 1_000_000);
    rate = Number.isFinite(micros) && micros > 0 ? formatRate(micros) : null;
  }
  return {
    source: row.source,
    month,
    zarCents: row.zar_cents,
    usdCents: row.usd_cents,
    rate,
    rateNote: row.rate_note,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

/** Manual entries count on the first day of their month. */
export function entryAmounts(rows: readonly FinanceEntryView[]): SourceAmount[] {
  return rows.map((r) => ({ source: r.source, date: `${r.month}-01`, cents: r.zarCents }));
}

export interface MissioFinanceDeps {
  /** Active bank accounts in the SA Xero mirror. */
  listBankAccounts(): Promise<{ data: BankAccountRow[] | null; error: { message?: string } | null }>;
  readReceipts(accountId: string, from: string, to: string): Promise<XeroBankReceiptsResult>;
  listEntries(fromMonth: string, toMonth: string): Promise<{ data: MissioFinanceEntryRow[] | null; error: { code?: string; message?: string } | null }>;
  configuredAccountId?: string | null;
}

const BANK_MESSAGES: Record<Exclude<BankState, "ok" | "account_unconfirmed">, string> = {
  not_connected: "Xero isn't connected right now, so bank and SnapScan income can't be read. Finance can reconnect it.",
  needs_scope:
    "Xero is connected, but without permission to read bank transactions. Finance needs to reconnect Xero with bank read access.",
  error: "Xero didn't answer, so bank and SnapScan income are missing for now. Try again in a few minutes.",
};

export async function loadMissioFinance(
  deps: MissioFinanceDeps,
  range: { fromMonth: string; today: string }
): Promise<MissioFinanceResponse> {
  const { fromMonth, today } = range;
  const from = `${fromMonth}-01`;

  const [bankPart, entriesPart] = await Promise.all([
    (async () => {
      const accounts = await deps.listBankAccounts();
      if (accounts.error || !accounts.data) {
        return { state: "error" as BankState, message: BANK_MESSAGES.error, accountLabel: null, receipts: [] as BankReceipt[] };
      }
      const picked = pickMissioBankAccount(accounts.data, deps.configuredAccountId);
      if (!picked.ok) return { state: picked.state as BankState, message: picked.message, accountLabel: null, receipts: [] };
      const accountLabel = bankAccountLabel(picked.account.name, picked.account.code);
      const result = await deps.readReceipts(picked.account.xero_account_id, from, today);
      if (result.status !== "ok") {
        return { state: result.status as BankState, message: BANK_MESSAGES[result.status], accountLabel, receipts: [] };
      }
      const id = picked.account.xero_account_id;
      const receipts = [
        ...result.bankTransactions.map((d) => receiptFromBankTransaction(d, id)),
        ...result.payments.map((d) => receiptFromPayment(d, id)),
      ].filter((r): r is BankReceipt => r !== null);
      return { state: "ok" as BankState, message: null, accountLabel, receipts };
    })(),
    (async () => {
      const res = await deps.listEntries(fromMonth, today.slice(0, 7));
      if (res.error) {
        if (isMissingTableError(res.error)) {
          return {
            state: "not_installed" as EntriesState,
            message: "Cash and FundraiseUp entries aren't switched on yet (database update 394 is waiting to be applied).",
            rows: [] as FinanceEntryView[],
          };
        }
        return { state: "error" as EntriesState, message: "Cash and FundraiseUp entries didn't load.", rows: [] };
      }
      const rows = (res.data ?? []).map(entryView).filter((r): r is FinanceEntryView => r !== null);
      return { state: "ok" as EntriesState, message: null, rows };
    })(),
  ]);

  const report = buildIncomeReport({
    fromMonth,
    today,
    amounts: [...bankAmounts(bankPart.receipts), ...entryAmounts(entriesPart.rows)],
  });

  return {
    report,
    bank: { state: bankPart.state, message: bankPart.message, accountLabel: bankPart.accountLabel },
    entries: { state: entriesPart.state, message: entriesPart.message, rows: entriesPart.rows },
  };
}
