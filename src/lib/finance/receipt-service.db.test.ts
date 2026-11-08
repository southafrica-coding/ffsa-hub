/**
 * Receipt and actuals services against the disposable workbook database.
 *
 * Cookie and getUser are a local HMAC JWT. There is no GoTrue and no browser.
 * After that, supabase-js talks to local PostgREST and Postgres. The /rest/v1
 * prefix supabase-js adds is removed so it hits PostgREST's root, the same
 * adapter as the workbook integration test.
 *
 * createXeroSpendMoney and listXeroSpendTransactions are mocked. Nothing is
 * sent to Slack or Xero. Skipped unless scripts/finance-receipts-db/run.sh
 * has set FFSA_RECEIPT_DB.
 */
import { createHmac } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.FFSA_RECEIPT_DB === "1";
const xero = vi.hoisted(() => ({
  lists: 0,
  posts: 0,
  failOnce: false,
  disconnectOnce: false,
  keys: [] as string[],
  reads: [] as { region: string; reference: string }[],
  readResult: { ok: true as const, transactions: [] as Record<string, unknown>[], partial: false } as
    | { ok: true; transactions: Record<string, unknown>[]; partial: boolean }
    | { ok: false; reason: "xero"; message: string },
}));

vi.mock("@/services/xero", () => ({
  listXeroSpendTransactions: async () => {
    xero.lists += 1;
    return { ok: true, transactions: [], partial: false };
  },
  listXeroBankTransactionsByReference: async (_client: unknown, region: string, reference: string) => {
    xero.reads.push({ region, reference });
    return xero.readResult;
  },
  // Each call is counted. This mock does not imitate Xero's Idempotency-Key store.
  createXeroSpendMoney: async (_admin: unknown, _region: unknown, args: { idempotencyKey: string }) => {
    xero.posts += 1;
    xero.keys.push(args.idempotencyKey);
    if (xero.disconnectOnce) {
      xero.disconnectOnce = false;
      return { ok: false, reason: "not_connected", message: "not connected" };
    }
    if (xero.failOnce) {
      xero.failOnce = false;
      return { ok: false, reason: "xero", message: "timeout" };
    }
    return { ok: true as const, bankTransactionId: `test-${xero.posts}-${args.idempotencyKey}` };
  },
}));

const gate = vi.hoisted(() => ({
  user: null as SupabaseClient | null,
  admin: null as SupabaseClient | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!gate.user) throw new Error("user client was not set");
    return gate.user;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!gate.admin) throw new Error("admin client was not set");
    return gate.admin;
  },
}));

import { GET } from "@/app/api/finance/budgets/[id]/actuals/route";
import { reconcileStalledSpend, writeConfirmedSpend, type ConfirmedSpend } from "@/lib/finance/record-xero-spend";
import { POST as reconcilePost } from "@/app/api/finance/outreach/receipts/xero/reconcile/route";
import { getBudgetActuals } from "@/services/budget-actuals";
import { confirmRepayment } from "@/lib/slack/outreach/repayments";

const FINANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OUTSIDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const TEAM = "11111111-1111-4111-8111-111111111111";
const DRAFT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const EXPENSE = "33333333-3333-4333-8333-333333333333";

function token(role: "authenticated" | "service_role", sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, sub, exp: 1893456000 })).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", process.env.FFSA_PGRST_JWT_SECRET || "local-harness-secret-not-production")
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

function client(url: string, role: "authenticated" | "service_role", sub: string): SupabaseClient {
  const jwt = token(role, sub);
  const db = createClient(url, jwt, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return fetch(raw.replace("/rest/v1", ""), init);
      },
    },
  });
  db.auth.getUser = (async () => ({ data: { user: { id: sub } }, error: null })) as typeof db.auth.getUser;
  return db;
}

function failBankIdUpdateOnce(inner: SupabaseClient): SupabaseClient {
  let armed = true;
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop !== "from") return Reflect.get(target, prop, recv);
      return (table: string) => {
        const query = (target.from as (name: string) => { update: (row: unknown) => unknown })(table);
        if (table !== "budget_xero_spends") return query;
        return new Proxy(query, {
          get(builder, key, builderRecv) {
            const value = Reflect.get(builder, key, builderRecv);
            if (key !== "update" || typeof value !== "function") {
              return typeof value === "function" ? value.bind(builder) : value;
            }
            return (row: { xero_bank_transaction_id?: string | null }) => {
              if (armed && row?.xero_bank_transaction_id) {
                armed = false;
                const rejected = {
                  eq() {
                    return rejected;
                  },
                  select() {
                    return rejected;
                  },
                  then(resolve: (value: unknown) => unknown) {
                    return Promise.resolve({ data: null, error: { code: "P0001", message: "test log write failed" } }).then(resolve);
                  },
                };
                return rejected;
              }
              return value.call(builder, row);
            };
          },
        });
      };
    },
  }) as SupabaseClient;
}

function spendFrom(proposal: Record<string, unknown>, date: string): ConfirmedSpend {
  return {
    draftId: DRAFT,
    expenseId: EXPENSE,
    hubUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
    confirmed: true,
    hasReceipt: true,
    repayment: false,
    zarConfirmed: true,
    amountZar: 12,
    date,
    description: "Food",
    vendor: "Shop",
    budgetId: String(proposal.budget_id),
    budgetLineId: String(proposal.budget_line_id),
    orgKey: "npc",
    currency: "ZAR",
    region: "za",
    paymentMethod: "card",
    budgetStatus: "approved",
    periodStart: String(proposal.budget_period_start),
    periodEnd: String(proposal.budget_period_end),
    proposal,
  };
}

describe.skipIf(!enabled)("receipt services on local PostgREST", () => {
  const full = process.env.FFSA_PGRST_URL ?? "";
  const noTable = process.env.FFSA_PGRST_NOTABLE_URL ?? "";
  let service: SupabaseClient;
  let finance: SupabaseClient;
  let leader: SupabaseClient;
  let outsider: SupabaseClient;
  let budgetId = "";
  let proposal: Record<string, unknown> = {};

  beforeAll(async () => {
    service = client(full, "service_role", FINANCE);
    finance = client(full, "authenticated", FINANCE);
    leader = client(full, "authenticated", LEADER);
    outsider = client(full, "authenticated", OUTSIDER);
    gate.admin = service;
    const budget = await service.from("budgets").select("id").eq("name", "Receipt service book").maybeSingle();
    if (budget.error || !budget.data) throw new Error(`receipt budget: ${budget.error?.message ?? "missing"}`);
    budgetId = budget.data.id as string;
    const draft = await service.from("outreach_receipt_drafts").select("proposal").eq("id", DRAFT).maybeSingle();
    if (draft.error || !draft.data) throw new Error(`receipt draft: ${draft.error?.message ?? "missing"}`);
    proposal = draft.data.proposal as Record<string, unknown>;
  });

  afterEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.XERO_SPEND_BANK_ACCOUNT_ZA;
  });

  it("hides the budget from an outsider and shows actuals to a member without finance_orgs", async () => {
    xero.lists = 0;
    const hidden = await getBudgetActuals(outsider, service, budgetId);
    expect(hidden.status).toBe(404);
    expect(xero.lists).toBe(0);

    const orgAsLeader = await leader.from("finance_orgs").select("id");
    expect(orgAsLeader.data ?? []).toEqual([]);

    const seen = await getBudgetActuals(leader, service, budgetId);
    expect(seen.status).toBe(200);
    expect(xero.lists).toBe(1);
    if (seen.status === 200) expect(seen.body).toMatchObject({ source: "xero", currency: "ZAR" });
  });

  it("uses the actuals route: finance 200, outsider 403, missing table 503", async () => {
    gate.user = finance;
    const ok = await GET(new Request("http://127.0.0.1/api/finance/budgets/" + budgetId + "/actuals"), {
      params: Promise.resolve({ id: budgetId }),
    });
    expect(ok.status).toBe(200);

    gate.user = outsider;
    const denied = await GET(new Request("http://127.0.0.1/api/finance/budgets/" + budgetId + "/actuals"), {
      params: Promise.resolve({ id: budgetId }),
    });
    expect(denied.status).toBe(403);

    const gap = client(noTable, "service_role", FINANCE);
    const missing = await getBudgetActuals(gap, gap, budgetId);
    expect(missing.status).toBe(503);
    expect(missing.body).toMatchObject({ code: "schema_not_applied" });
  });

  it("confirms a repayment once per Slack message ts, including two sessions", async () => {
    const stamp = Date.now();
    const firstTs = `${stamp}.000100`;
    const secondTs = `${stamp}.000200`;
    const value = `18000|ZAR|${TEAM}|URECEIPTCLM|taxi`;
    const first = await confirmRepayment(service, "URECEIPTCLM", value, { messageTs: firstTs });
    const repeat = await confirmRepayment(service, "URECEIPTCLM", value, { messageTs: firstTs });
    const second = await confirmRepayment(service, "URECEIPTOWN", value, { messageTs: secondTs });
    expect(first.text).toMatch(/noted on the budget/);
    expect(repeat.text).toMatch(/already noted/);
    expect(second.text).toMatch(/noted on the budget/);

    const stranger = await confirmRepayment(service, "UOUTSIDER1", value, { messageTs: `${stamp}.000300` });
    expect(stranger.text).toMatch(/Only the person who spent this/);

    const raceTs = `${stamp}.000400`;
    await Promise.all([
      confirmRepayment(service, "URECEIPTCLM", value, { messageTs: raceTs }),
      confirmRepayment(service, "URECEIPTCLM", value, { messageTs: raceTs }),
    ]);
    const rows = await service.from("budget_repayments").select("slack_message_ts").in("slack_message_ts", [firstTs, secondTs, raceTs]);
    expect(rows.data?.map((row) => row.slack_message_ts).sort()).toEqual([firstTs, secondTs, raceTs].sort());
  });

  async function freshSpend(label: string): Promise<ConfirmedSpend> {
    const category = await service.from("outreach_budget_categories").select("id").eq("slug", "food").single();
    const made = await service
      .from("outreach_expenses")
      .insert({
        team_id: TEAM,
        category_id: category.data?.id,
        expense_date: proposal.expense_date,
        description: label,
        payment_method: "card",
        local_currency: "ZAR",
        local_amount: 12,
        zar_amount: 12,
        source: "slack",
        created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
      })
      .select("id")
      .single();
    if (made.error || !made.data) throw new Error(made.error?.message ?? "expense missing");
    const draft = await service
      .from("outreach_receipt_drafts")
      .insert({
        team_id: TEAM,
        hub_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
        slack_user_id: "URECEIPTOWN",
        channel_id: "DTEST",
        file_name: `${label}.jpg`,
        file_sha256: label,
        storage_path: `receipts/${label}.jpg`,
        proposal,
        status: "logged",
        expense_id: made.data.id,
      })
      .select("id")
      .single();
    if (draft.error || !draft.data) throw new Error(draft.error?.message ?? "draft missing");
    return { ...spendFrom(proposal, String(proposal.expense_date)), draftId: draft.data.id as string, expenseId: made.data.id as string };
  }

  it("does not post or read Xero for an inactive NPC org, then restores it", async () => {
    const fresh = await freshSpend("inactive");
    const off = await service.from("finance_orgs").update({ is_active: false }).eq("key", "npc").select("id");
    expect(off.error).toBeNull();
    try {
      xero.lists = 0;
      xero.posts = 0;
      const actuals = await getBudgetActuals(finance, service, budgetId);
      expect(actuals.status).toBe(409);
      expect(xero.lists).toBe(0);
      const posted = await writeConfirmedSpend(service, fresh);
      expect(posted.status).toBe("org_not_south_africa");
      expect(xero.posts).toBe(0);
      const before = await service.from("budget_repayments").select("id", { count: "exact", head: true });
      await confirmRepayment(service, "URECEIPTCLM", `19000|ZAR|${TEAM}|URECEIPTCLM|inactive taxi`, {
        messageTs: "1710000001.000500",
      });
      const after = await service.from("budget_repayments").select("id", { count: "exact", head: true });
      expect(after.count).toBe(before.count);
    } finally {
      const on = await service.from("finance_orgs").update({ is_active: true }).eq("key", "npc");
      expect(on.error).toBeNull();
    }
  });

  it("skips a spend dated outside the period and posts one row for a retry", async () => {
    const outsideInput = await freshSpend("outside");
    xero.posts = 0;
    const outside = await writeConfirmedSpend(service, { ...outsideInput, date: "2000-01-01" });
    expect(outside.status).toBe("outside_period");
    expect(xero.posts).toBe(0);
    const none = await service.from("budget_xero_spends").select("id").eq("receipt_draft_id", outsideInput.draftId);
    expect(none.data ?? []).toHaveLength(0);

    const input = await freshSpend("retry");
    process.env.XERO_SPEND_BANK_ACCOUNT_ZA = "TEST-ONLY-NOT-PRODUCTION";
    xero.posts = 0;
    const first = await writeConfirmedSpend(service, input);
    const second = await writeConfirmedSpend(service, input);
    expect(first.status).toBe("written");
    expect(second.status).toBe("already_written");
    expect(xero.posts).toBe(1);
    const rows = await service.from("budget_xero_spends").select("id, receipt_draft_id, line_id, budget_id").eq("receipt_draft_id", input.draftId);
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0]).toMatchObject({ receipt_draft_id: input.draftId, budget_id: budgetId });
    expect(rows.data?.[0]).not.toHaveProperty("currency");
    expect(rows.data?.[0]).not.toHaveProperty("org_key");
  });

  it("keeps one draft row when a post fails and when two sessions insert together", async () => {
    process.env.XERO_SPEND_BANK_ACCOUNT_ZA = "TEST-ONLY-NOT-PRODUCTION";
    const input = await freshSpend("fail");
    xero.posts = 0;
    xero.keys = [];
    xero.failOnce = true;
    const failed = await writeConfirmedSpend(service, input);
    expect(failed.status).toBe("blocked");
    const again = await writeConfirmedSpend(service, input);
    expect(again.status).toBe("in_flight");
    expect(xero.posts).toBe(1);
    expect(xero.keys).toEqual([`ffsa-expense-${input.expenseId}`]);
    const afterRetry = await service.from("budget_xero_spends").select("xero_status, xero_bank_transaction_id").eq("receipt_draft_id", input.draftId);
    expect(afterRetry.data).toHaveLength(1);
    expect(afterRetry.data?.[0]).toMatchObject({ xero_status: "blocked", xero_bank_transaction_id: null });

    const raceInput = await freshSpend(`race-${Date.now()}`);
    xero.posts = 0;
    xero.keys = [];
    await Promise.all([writeConfirmedSpend(service, raceInput), writeConfirmedSpend(service, raceInput)]);
    const raced = await service.from("budget_xero_spends").select("id, xero_bank_transaction_id").eq("receipt_draft_id", raceInput.draftId);
    expect(raced.data).toHaveLength(1);
    expect(xero.posts).toBe(1);
    expect(xero.keys).toEqual([`ffsa-expense-${raceInput.expenseId}`]);
  });

  it("repairs the log after Xero succeeded and the log write failed, without a second post", async () => {
    process.env.XERO_SPEND_BANK_ACCOUNT_ZA = "TEST-ONLY-NOT-PRODUCTION";
    const input = await freshSpend(`log-fail-${Date.now()}`);
    xero.posts = 0;
    xero.keys = [];
    const flaky = failBankIdUpdateOnce(service);
    const first = await writeConfirmedSpend(flaky, input);
    expect(first.status).toBe("written");
    expect(xero.posts).toBe(1);
    expect(xero.keys).toEqual([`ffsa-expense-${input.expenseId}`]);
    const unpaid = await service.from("budget_xero_spends").select("xero_bank_transaction_id").eq("receipt_draft_id", input.draftId).maybeSingle();
    expect(unpaid.data?.xero_bank_transaction_id ?? null).toBeNull();

    const retry = await writeConfirmedSpend(service, input);
    expect(retry.status).toBe("already_written");
    expect(xero.posts).toBe(1);
    expect(xero.keys).toEqual([`ffsa-expense-${input.expenseId}`]);
    const paid = await service.from("budget_xero_spends").select("xero_bank_transaction_id").eq("receipt_draft_id", input.draftId).maybeSingle();
    expect(paid.data?.xero_bank_transaction_id).toBe(first.bankTransactionId);
  });

  it("reconciles a stalled claim only when one read matches, and never posts", async () => {
    process.env.XERO_SPEND_BANK_ACCOUNT_ZA = "TEST-ONLY-NOT-PRODUCTION";
    const input = await freshSpend(`stall-${Date.now()}`);
    xero.posts = 0;
    const claimed = await service.from("budget_xero_spends").insert({
      budget_id: input.budgetId,
      line_id: input.budgetLineId,
      outreach_expense_id: input.expenseId,
      receipt_draft_id: input.draftId,
      purchaser_user_id: input.hubUserId,
      amount_cents: 1200,
      spent_on: input.date,
      description: "Food",
      has_receipt: true,
      xero_status: "posting",
      confirmed_at: new Date().toISOString(),
    }).select("xero_status");
    expect(claimed.error).toBeNull();
    expect(xero.posts).toBe(0);

    const reference = `ffsa-expense-${input.expenseId}`;
    const good = {
      BankTransactionID: `bt-${input.draftId}`,
      Reference: reference,
      Type: "SPEND",
      Status: "AUTHORISED",
      DateString: String(proposal.expense_date),
      CurrencyCode: "ZAR",
      Total: 12,
    };
    gate.user = finance;
    gate.admin = service;

    xero.reads = [];
    xero.readResult = { ok: false, reason: "xero", message: "timeout" };
    const timedOut = await reconcilePost(new Request("http://127.0.0.1/reconcile", { method: "POST", body: JSON.stringify({ draftId: input.draftId, bankTransactionId: "forged" }) }));
    expect(timedOut.status).toBe(200);
    expect(await timedOut.json()).toMatchObject({ status: "blocked", reason: "unproven" });
    expect(xero.posts).toBe(0);

    xero.readResult = { ok: true, transactions: [], partial: false };
    const missing = await reconcileStalledSpend(finance, service, input.draftId);
    expect(missing.body).toMatchObject({ status: "blocked", reason: "not_found" });

    xero.readResult = { ok: true, transactions: [good, { ...good, BankTransactionID: "bt-2" }], partial: false };
    const many = await reconcileStalledSpend(finance, service, input.draftId);
    expect(many.body).toMatchObject({ status: "blocked", reason: "ambiguous" });

    xero.readResult = { ok: true, transactions: [{ ...good, Total: 99 }], partial: false };
    const wrongAmount = await reconcileStalledSpend(finance, service, input.draftId);
    expect(wrongAmount.body).toMatchObject({ status: "blocked", reason: "mismatch" });

    xero.readResult = { ok: true, transactions: [{ ...good, CurrencyCode: "USD" }], partial: false };
    expect((await reconcileStalledSpend(finance, service, input.draftId)).body).toMatchObject({ reason: "mismatch" });

    xero.readResult = { ok: true, transactions: [{ ...good, DateString: "2001-01-01" }], partial: false };
    expect((await reconcileStalledSpend(finance, service, input.draftId)).body).toMatchObject({ reason: "mismatch" });

    xero.posts = 0;
    xero.reads = [];
    xero.readResult = { ok: true, transactions: [good], partial: false };
    const [first, second] = await Promise.all([
      reconcileStalledSpend(finance, service, input.draftId),
      reconcileStalledSpend(finance, service, input.draftId),
    ]);
    const statuses = [first.body.status, second.body.status].sort();
    expect(statuses).toEqual(["already_recorded", "reconciled"]);
    expect(xero.posts).toBe(0);
    expect(xero.reads.every((read) => read.region === "za" && read.reference === reference)).toBe(true);
    const row = await service.from("budget_xero_spends").select("xero_bank_transaction_id, xero_status").eq("receipt_draft_id", input.draftId).maybeSingle();
    expect(row.data).toMatchObject({ xero_bank_transaction_id: `bt-${input.draftId}`, xero_status: "written" });
    const audit = await finance
      .from("finance_audit_log")
      .select("actor_user_id, action, entity_type")
      .eq("entity_type", "budget_xero_spends")
      .eq("action", "update")
      .order("at", { ascending: false })
      .limit(1);
    expect(audit.data?.[0]).toMatchObject({ actor_user_id: FINANCE, action: "update" });

    gate.user = outsider;
    const denied = await reconcilePost(new Request("http://127.0.0.1/reconcile", { method: "POST", body: JSON.stringify({ draftId: input.draftId }) }));
    expect(denied.status).toBe(403);
  });

  it("does not post from a preview deployment", async () => {
    process.env.VERCEL_ENV = "preview";
    xero.posts = 0;
    const result = await writeConfirmedSpend(service, spendFrom(proposal, String(proposal.expense_date)));
    expect(result.status).toBe("preview_blocked");
    expect(xero.posts).toBe(0);
  });
});
