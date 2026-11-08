import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "pat" as string | null,
  saved: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
  }),
}));

vi.mock("@/services/budget-workbook", () => ({
  getBudgetWorkbook: async (_client: unknown, id: string) => ({ status: 200, body: { budget: { id } } }),
  saveBudgetWorkbook: async (_client: unknown, id: string, body: unknown) => {
    state.saved.push({ id, body });
    return { status: 200, body: { budget: { id, notes: "saved" } } };
  },
}));

const { GET, PUT, PATCH } = await import("./route");
const context = { params: Promise.resolve({ id: "44444444-4444-4444-8444-444444444444" }) };

beforeEach(() => {
  state.userId = "pat";
  state.saved = [];
  delete process.env.VERCEL_ENV;
});

describe("/api/finance/budgets/[id]", () => {
  it("requires a signed-in user", async () => {
    state.userId = null;
    const res = await GET(new Request("http://localhost/api/finance/budgets/x"), context);
    expect(res.status).toBe(401);
  });

  it("loads the workbook", async () => {
    const res = await GET(new Request("http://localhost/api/finance/budgets/x"), context);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ budget: { id: "44444444-4444-4444-8444-444444444444" } });
  });

  it("blocks a preview save before any workbook call", async () => {
    process.env.VERCEL_ENV = "preview";
    const body = JSON.stringify({ notes: "Bring receipts.", updatedAt: "2026-11-08T00:00:00.000Z" });
    const put = await PUT(new Request("http://localhost/api/finance/budgets/x", { method: "PUT", body }), context);
    const patch = await PATCH(new Request("http://localhost/api/finance/budgets/x", { method: "PATCH", body }), context);
    expect(put.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(await put.json()).toMatchObject({ error: "preview_writes_disabled" });
    expect(state.saved).toEqual([]);
  });

  it("saves on PUT and PATCH", async () => {
    const body = JSON.stringify({ notes: "Bring receipts." });
    const put = await PUT(new Request("http://localhost/api/finance/budgets/x", { method: "PUT", body }), context);
    const patch = await PATCH(new Request("http://localhost/api/finance/budgets/x", { method: "PATCH", body }), context);
    expect(put.status).toBe(200);
    expect(patch.status).toBe(200);
    expect(state.saved).toHaveLength(2);
    expect(state.saved[0]).toMatchObject({ body: { notes: "Bring receipts." } });
  });
});
