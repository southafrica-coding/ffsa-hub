import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isMissingTableError, loadMissioFinance, pickMissioBankAccount, type MissioFinanceDeps } from "./server";
import { readEntryInput, readEntryKey } from "./entry-input";
import { formatZar } from "./report";

// Fakes only: no Supabase, no Xero. Ids and amounts are made up.
const MISSIO_ACC = "00000000-0000-4000-8000-0000000000aa";
const ACCOUNTS = [
  { xero_account_id: "00000000-0000-4000-8000-000000000001", name: "Business - 00000000001", code: "5010" },
  { xero_account_id: MISSIO_ACC, name: "MISSIO - 00000000002", code: "5110" },
];

function deps(over: Partial<MissioFinanceDeps> = {}): MissioFinanceDeps {
  return {
    listBankAccounts: async () => ({ data: ACCOUNTS, error: null }),
    readReceipts: async () => ({
      status: "ok",
      bankTransactions: [
        { Type: "RECEIVE", Status: "AUTHORISED", BankAccount: { AccountID: MISSIO_ACC }, DateString: "2026-08-03T00:00:00", Total: 1000, Reference: "EFT" },
        { Type: "RECEIVE", Status: "AUTHORISED", BankAccount: { AccountID: MISSIO_ACC }, DateString: "2026-08-20T00:00:00", Total: 250, Reference: "SNAPSCAN 991" },
      ],
      payments: [],
    }),
    listEntries: async () => ({
      data: [
        { id: "e1", source: "cash", month: "2026-08-01", cash_cents: 190000, usd_cents: null, usd_zar_rate: null, rate_note: null, zar_cents: 190000, note: null, updated_at: "2026-11-01T00:00:00Z" },
        { id: "e2", source: "fundraiseup", month: "2026-09-01", cash_cents: null, usd_cents: 10000, usd_zar_rate: "18.250000", rate_note: "Xero", zar_cents: 182500, note: null, updated_at: "2026-11-01T00:00:00Z" },
      ],
      error: null,
    }),
    ...over,
  };
}

const RANGE = { fromMonth: "2026-07", today: "2026-11-23" };

describe("Missio bank account", () => {
  it("is the one bank account named MISSIO", () => {
    expect(pickMissioBankAccount(ACCOUNTS)).toEqual({ ok: true, account: ACCOUNTS[1] });
  });

  it("needs confirming when none or several match", () => {
    expect(pickMissioBankAccount([ACCOUNTS[0]])).toMatchObject({ ok: false, state: "account_unconfirmed" });
    expect(pickMissioBankAccount([ACCOUNTS[1], { ...ACCOUNTS[1], xero_account_id: "x" }])).toMatchObject({ ok: false });
  });

  it("follows MISSIO_XERO_BANK_ACCOUNT_ID when set", () => {
    expect(pickMissioBankAccount(ACCOUNTS, ACCOUNTS[0].xero_account_id)).toEqual({ ok: true, account: ACCOUNTS[0] });
    expect(pickMissioBankAccount(ACCOUNTS, "nope")).toMatchObject({ ok: false });
  });
});

describe("loadMissioFinance", () => {
  it("adds Xero receipts and entries into one report, SnapScan split out", async () => {
    const readReceipts = vi.fn(deps().readReceipts);
    const res = await loadMissioFinance(deps({ readReceipts }), RANGE);
    expect(readReceipts).toHaveBeenCalledWith(MISSIO_ACC, "2026-07-01", "2026-11-23");
    expect(res.bank).toEqual({ state: "ok", message: null, accountLabel: "MISSIO (account 5110)" });
    const aug = res.report.months.find((m) => m.key === "2026-08")!;
    expect(aug.bySource).toEqual({ bank: 100000, snapscan: 25000, fundraiseup: null, cash: 190000 });
    expect(res.report.months.find((m) => m.key === "2026-09")!.bySource.fundraiseup).toBe(182500);
    expect(formatZar(res.report.total)).toBe("R4,975.00");
    expect(res.entries.rows[1]).toMatchObject({ source: "fundraiseup", month: "2026-09", usdCents: 10000, rate: "18.25" });
  });

  it("keeps the account number and transaction text out of the response", async () => {
    const res = await loadMissioFinance(deps(), RANGE);
    const json = JSON.stringify(res);
    expect(json).not.toContain("00000000002");
    expect(json).not.toContain("SNAPSCAN 991");
    expect(json).not.toContain(MISSIO_ACC);
  });

  it("says why bank figures are missing when Xero lacks the bank scope", async () => {
    const res = await loadMissioFinance(
      deps({ readReceipts: async () => ({ status: "needs_scope", message: "x" }) }),
      RANGE
    );
    expect(res.bank.state).toBe("needs_scope");
    expect(res.bank.message).toMatch(/reconnect Xero/);
    expect(res.report.sources.find((s) => s.key === "bank")!.total).toBeNull();
    expect(res.report.sources.find((s) => s.key === "cash")!.total).toBe(190000);
  });

  it("doesn't call Xero when the account isn't confirmed", async () => {
    const readReceipts = vi.fn();
    const res = await loadMissioFinance(deps({ listBankAccounts: async () => ({ data: [ACCOUNTS[0]], error: null }), readReceipts }), RANGE);
    expect(readReceipts).not.toHaveBeenCalled();
    expect(res.bank.state).toBe("account_unconfirmed");
  });

  it("runs before migration 394: entries are 'not installed', nothing invented", async () => {
    const res = await loadMissioFinance(
      deps({
        listEntries: async () => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.missio_finance_entries' in the schema cache" } }),
        readReceipts: async () => ({ status: "needs_scope", message: "x" }),
      }),
      RANGE
    );
    expect(res.entries.state).toBe("not_installed");
    expect(res.report.hasData).toBe(false);
    expect(res.report.total).toBe(0);
  });

  it("recognises a missing table", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("entry input", () => {
  const today = "2026-11-23";

  it("accepts cash in rand", () => {
    expect(readEntryInput({ source: "cash", month: "2026-08", amount: "1,900" }, today)).toEqual({
      ok: true,
      entry: { source: "cash", month: "2026-08", cashCents: 190000, note: null },
    });
  });

  it("accepts FundraiseUp dollars and a rate, normalising the rate", () => {
    expect(readEntryInput({ source: "fundraiseup", month: "2026-09", usd: "2977.28", rate: "18.250", rateNote: " Xero " }, today)).toEqual({
      ok: true,
      entry: { source: "fundraiseup", month: "2026-09", usdCents: 297728, rate: "18.25", rateNote: "Xero", note: null },
    });
  });

  it("refuses future months, months before July 2026, bad amounts and rates", () => {
    expect(readEntryInput({ source: "cash", month: "2026-12", amount: "1" }, today)).toMatchObject({ ok: false, fieldErrors: { month: expect.any(String) } });
    expect(readEntryInput({ source: "cash", month: "2026-06", amount: "1" }, today)).toMatchObject({ ok: false });
    expect(readEntryInput({ source: "cash", month: "2026-08", amount: "-1" }, today)).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(String) } });
    expect(readEntryInput({ source: "fundraiseup", month: "2026-08", usd: "10", rate: "0" }, today)).toMatchObject({ ok: false, fieldErrors: { rate: expect.any(String) } });
    expect(readEntryInput({ source: "bank", month: "2026-08", amount: "1" }, today)).toMatchObject({ ok: false, fieldErrors: { source: expect.any(String) } });
    expect(readEntryInput(null, today)).toMatchObject({ ok: false });
  });

  it("reads the delete key", () => {
    expect(readEntryKey(new URLSearchParams("source=cash&month=2026-08"))).toEqual({ source: "cash", month: "2026-08" });
    expect(readEntryKey(new URLSearchParams("source=bank&month=2026-08"))).toBeNull();
  });
});

describe("migration 394", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/394_missio_finance_entries.sql"), "utf8");

  it("enables RLS on both tables and limits every policy to Missio pastors", () => {
    expect(sql).toMatch(/ALTER TABLE public\.missio_finance_entries\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.missio_finance_entry_events ENABLE ROW LEVEL SECURITY/);
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(5);
    for (const p of policies) expect(p).toContain("has_org_role_id(org_id, ARRAY['pastor'])");
    for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(policies.some((p) => p.includes(`ON public.missio_finance_entries FOR ${cmd}`))).toBe(true);
    }
    // The audit trail is read-only to people; only the trigger writes it.
    expect(policies.filter((p) => p.includes("missio_finance_entry_events"))).toHaveLength(1);
  });

  it("computes the rand amount in the database and seeds nothing", () => {
    expect(sql).toContain("round(usd_cents * usd_zar_rate)::bigint");
    expect(sql).not.toMatch(/INSERT INTO public\.missio_finance_entries/);
  });
});
