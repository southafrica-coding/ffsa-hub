import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type FakeQuery, type PermissionWorld } from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  draft: null as Record<string, unknown> | null,
  expense: null as Record<string, unknown> | null,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.fake.client }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const row = table === "outreach_expenses" ? state.expense : table === "outreach_receipt_drafts" ? state.draft : null;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/finance/record-xero-spend", () => ({
  writeConfirmedSpend: async (_admin: unknown, input: Record<string, unknown>) => {
    state.calls.push(input);
    return { status: "no_account", bankTransactionId: null };
  },
}));

import { POST } from "./route";

function world(access: PermissionWorld, perms: string[] = [], user: { id: string } | null = { id: "me" }) {
  state.fake = createFakeSupabase({
    user,
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_permission") {
        return { data: perms.includes((q.rpc.args as { required_permission: string }).required_permission) };
      }
      return permissionWorldResolver(access)(q) ?? { data: [] };
    },
  });
}

const call = (body?: unknown) =>
  POST(new Request("http://x/api/finance/outreach/receipts/xero", { method: "POST", body: JSON.stringify(body ?? {}) }));

describe("POST /api/finance/outreach/receipts/xero", () => {
  beforeEach(() => {
    state.calls = [];
    state.draft = {
      id: "d1",
      status: "logged",
      kind: "receipt",
      expense_id: "e1",
      hub_user_id: "u1",
      storage_path: "team/slack/d1/photo.jpg",
      proposal: { description: "Groceries", vendor: "Shop", expense_date: "2026-11-01", zar_amount: 10, local_currency: "ZAR", budget_line_label: "Food — Groceries" },
    };
    state.expense = { zar_amount: 12, zar_confirmed: true, local_currency: "BWP", expense_date: "2026-11-02" };
    world({ roles: [{ id: "r", name: "finance_admin" }], direct: [] });
  });

  it("401 when signed out and 403 without finance edit", async () => {
    world({ roles: [], direct: [] }, [], null);
    expect((await call({ draftId: "d1" })).status).toBe(401);
    world({ roles: [{ id: "r", name: "events_admin" }], direct: [] });
    expect((await call({ draftId: "d1" })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("refuses a draft that has not been confirmed", async () => {
    state.draft = { ...state.draft, status: "pending" };
    const res = await call({ draftId: "d1" });
    expect(res.status).toBe(409);
    expect(state.calls).toEqual([]);
  });

  it("sends a confirmed receipt on, and does not confirm one itself", async () => {
    const res = await call({ draftId: "d1" });
    expect(res.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      draftId: "d1",
      confirmed: true,
      hasReceipt: true,
      repayment: false,
      zarConfirmed: true,
      amountZar: 12,
      description: "Food — Groceries",
    });
    expect(await res.json()).toEqual({ status: "no_account", bankTransactionId: null });
  });
});
