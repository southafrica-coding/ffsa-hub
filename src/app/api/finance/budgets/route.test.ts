import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "pat" as string | null,
  adminCalls: [] as string[],
  created: [] as unknown[],
  listed: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      state.adminCalls.push(`from:${table}`);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "insert", "update", "upsert", "delete", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          state.adminCalls.push(`${method}:${JSON.stringify(args)}`);
          return method === "maybeSingle" ? Promise.resolve({ data: null, error: null }) : builder;
        };
      }
      return builder;
    },
    rpc() {
      state.adminCalls.push("rpc");
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

vi.mock("@/services/budget-workbook", () => ({
  FINANCE_ORG_COLUMNS: "id, key, name, record_currency, is_active",
  createBudgetWorkbook: async (...args: unknown[]) => {
    state.created.push(args[1]);
    return { status: 201, body: { budget: { id: "budget-1" } } };
  },
  listBudgetWorkbooks: async () => {
    state.listed += 1;
    return { status: 503, body: { error: "Saving a budget isn't available yet. The workbook tables aren't in the database.", code: "schema_not_applied" } };
  },
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  state.userId = "pat";
  state.adminCalls = [];
  state.created = [];
  state.listed = 0;
  delete process.env.VERCEL_ENV;
});

describe("POST /api/finance/budgets", () => {
  it("requires a signed-in user", async () => {
    state.userId = null;
    const res = await POST(new Request("http://localhost/api/finance/budgets", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(state.created).toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(new Request("http://localhost/api/finance/budgets", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
    expect(state.created).toEqual([]);
  });

  it("saves as the signed-in user on a preview deployment and does not write with the service role", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await POST(
      new Request("http://localhost/api/finance/budgets", {
        method: "POST",
        body: JSON.stringify({ name: "DTS 2027" }),
      })
    );
    expect(res.status).toBe(201);
    expect(state.created).toEqual([{ name: "DTS 2027" }]);
    expect(state.adminCalls.filter((call) => /insert|update|upsert|delete|rpc/.test(call))).toEqual([]);
  });
});

describe("GET /api/finance/budgets", () => {
  it("forwards schema_not_applied", async () => {
    const res = await GET(new Request("http://localhost/api/finance/budgets"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "schema_not_applied" });
    expect(state.listed).toBe(1);
  });
});
