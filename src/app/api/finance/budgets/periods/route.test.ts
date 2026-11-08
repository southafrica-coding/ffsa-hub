import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "pat" as string | null,
  calls: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
  }),
}));

vi.mock("@/services/budget-workbook", () => ({
  listWorkbookPeriods: async (_client: unknown, ownerKind: string | null, ownerId: string | null) => {
    state.calls.push({ ownerKind, ownerId });
    return { status: 200, body: { periods: [{ id: "p1", label: "2027", kind: "year", start: "2027-01-01", end: "2027-12-31", current: false }] } };
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  state.userId = "pat";
  state.calls = [];
});

describe("GET /api/finance/budgets/periods", () => {
  it("requires a signed-in user", async () => {
    state.userId = null;
    const res = await GET(new Request("http://localhost/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=x"));
    expect(res.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("passes the owner selector to the service", async () => {
    const res = await GET(
      new Request("http://localhost/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=cccccccc-cccc-4ccc-8ccc-ccccccccccc1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      periods: [{ id: "p1", label: "2027", kind: "year", start: "2027-01-01", end: "2027-12-31", current: false }],
    });
    expect(state.calls).toEqual([{ ownerKind: "staff_ministry", ownerId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" }]);
  });
});
