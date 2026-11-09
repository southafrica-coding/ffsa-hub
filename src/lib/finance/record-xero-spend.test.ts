import { describe, expect, it, vi } from "vitest";

const posted = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/services/xero", () => ({
  createXeroSpendMoney: async () => {
    posted.calls += 1;
    return { ok: true, bankTransactionId: "bt" };
  },
}));

import { writeConfirmedSpend, type ConfirmedSpend } from "./record-xero-spend";

function adminWith(org: { key: string; is_active: boolean; record_currency: string } | null) {
  const writes: string[] = [];
  function chain(table: string) {
    const api = {
      select() {
        return api;
      },
      eq() {
        return api;
      },
      in() {
        return api;
      },
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => {
        if (table === "budgets") return { data: { org_id: "org-1", currency: "ZAR" }, error: null };
        if (table === "finance_orgs") return { data: org, error: null };
        if (table === "outreach_receipt_drafts") return { data: { proposal: {} }, error: null };
        return { data: null, error: null };
      },
      update() {
        writes.push(`${table}:update`);
        return { eq: async () => ({ error: null }) };
      },
      insert(row: unknown) {
        writes.push(`${table}:insert`);
        return { error: null, data: row };
      },
    };
    return api;
  }
  return { from: (table: string) => chain(table), writes };
}

const spend: ConfirmedSpend = {
  draftId: "d1",
  expenseId: null,
  hubUserId: "u1",
  confirmed: true,
  hasReceipt: true,
  repayment: false,
  zarConfirmed: true,
  amountZar: 12,
  date: "2026-06-01",
  description: "Food",
  vendor: "Shop",
  budgetId: "b1",
  budgetLineId: "l1",
  orgKey: "npc",
  currency: "ZAR",
  region: "za",
  paymentMethod: "card",
  budgetStatus: "approved",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  proposal: {},
};

describe("writeConfirmedSpend org gate", () => {
  it("does not post or log when the budget org is inactive or not NPC", async () => {
    for (const org of [
      { key: "npc", is_active: false, record_currency: "ZAR" },
      { key: "usa", is_active: true, record_currency: "ZAR" },
    ]) {
      posted.calls = 0;
      const admin = adminWith(org);
      const result = await writeConfirmedSpend(admin, spend);
      expect(result).toEqual({ status: "org_not_south_africa", bankTransactionId: null });
      expect(posted.calls).toBe(0);
      expect(admin.writes.some((write) => write.startsWith("budget_xero_spends"))).toBe(false);
    }
  });

  it("does not refuse an active NPC rand org", async () => {
    posted.calls = 0;
    const admin = adminWith({ key: "npc", is_active: true, record_currency: "ZAR" });
    const result = await writeConfirmedSpend(admin, spend);
    expect(result.status).not.toBe("org_not_south_africa");
    expect(posted.calls).toBe(0);
  });
});
