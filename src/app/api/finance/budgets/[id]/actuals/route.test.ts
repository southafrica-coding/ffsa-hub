import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type FakeQuery, type PermissionWorld } from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  xero: { ok: true, transactions: [] as unknown[], partial: false } as
    | { ok: true; transactions: unknown[]; partial: boolean }
    | { ok: false; reason: "not_connected" | "xero"; message: string },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.fake.client }));
vi.mock("@/services/xero", async (orig) => ({
  ...(await orig<typeof import("@/services/xero")>()),
  listXeroSpendTransactions: async () => state.xero,
}));

import { GET } from "./route";

function world(access: PermissionWorld, perms: string[] = [], user: { id: string } | null = { id: "me" }, budgets?: (q: FakeQuery) => { data?: unknown; error?: unknown } | undefined) {
  state.fake = createFakeSupabase({
    user,
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_permission") {
        return { data: perms.includes((q.rpc.args as { required_permission: string }).required_permission) };
      }
      const budget = budgets?.(q);
      if (budget) return budget;
      return permissionWorldResolver(access)(q) ?? { data: [] };
    },
  });
}

const NO_ROLES: PermissionWorld = { roles: [], direct: [] };
const call = (id = "b1") => GET(new Request("http://x/api/finance/budgets/b1/actuals"), { params: Promise.resolve({ id }) });

describe("GET /api/finance/budgets/[id]/actuals", () => {
  beforeEach(() => {
    state.xero = { ok: true, transactions: [], partial: false };
  });

  it("401 when not signed in", async () => {
    world(NO_ROLES, [], null);
    expect((await call()).status).toBe(401);
  });

  it("403 without finance access", async () => {
    world({ roles: [{ id: "r", name: "events_admin" }], direct: [] });
    expect((await call()).status).toBe(403);
  });

  it("503 until the budget tables exist, and does not invent actuals", async () => {
    world(NO_ROLES, ["finance.view"], { id: "me" }, (q) =>
      q.table === "budgets"
        ? { data: null, error: { code: "PGRST205", message: "Could not find the table public.budgets in the schema cache" } }
        : undefined
    );
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "schema_not_applied" });
  });

  it("reads actuals from Xero spend, not from outreach expenses", async () => {
    state.xero = {
      ok: true,
      partial: false,
      transactions: [
        {
          BankTransactionID: "bt-1",
          Date: "2026-02-01",
          LineItems: [
            { AccountCode: "400", LineAmount: 180, Tracking: [{ Name: "Ministries", Option: "Botswana" }] },
          ],
        },
      ],
    };
    world(NO_ROLES, ["finance.view"], { id: "me" }, (q) => {
      if (q.table === "budgets") {
        return {
          data: {
            id: "b1",
            name: "Botswana",
            currency: "ZAR",
            archived_at: null,
            fiscal_periods: { start_date: "2026-01-01", end_date: "2026-12-31" },
            budget_lines: [
              {
                id: "l1",
                name: "Food for the team",
                line_total_cents: 100000,
                archived_at: null,
                budget_line_coding: [
                  { org_region: "za", account_id: "a1", tracking_option_1_id: "o1", tracking_option_2_id: null },
                ],
              },
            ],
          },
        };
      }
      if (q.table === "xero_accounts") return { data: [{ id: "a1", code: "400", status: "ACTIVE" }] };
      if (q.table === "xero_tracking_options") return { data: [{ id: "o1", name: "Botswana", category_id: "c1" }] };
      if (q.table === "xero_tracking_categories") return { data: [{ id: "c1", name: "Ministries" }] };
      return undefined;
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("xero");
    expect(body.lines).toEqual([
      { lineId: "l1", name: "Food for the team", plannedCents: 100000, actualCents: 18000, differenceCents: 82000 },
    ]);
    expect(JSON.stringify(state.fake.queries.map((q) => q.table))).not.toContain("outreach_expenses");
  });
});
