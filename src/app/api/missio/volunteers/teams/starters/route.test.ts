import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route is a thin pastor wall around addStarterTeams. The role check and
// rate limit are stubbed here; addStarterTeams has its own tests.

const state = vi.hoisted(() => ({
  access: null as null | { response: unknown } | { supabase: unknown; orgId: string; user: { id: string } },
  calls: [] as Array<{ orgId: string }>,
}));

vi.mock("@/lib/missio/access", () => ({
  MISSIO_SLUG: "missio",
  MISSIO_PEOPLE_ROLES: ["pastor"],
  requireOrgRole: async () => state.access,
}));
vi.mock("@/lib/missio/availability/limit", () => ({ pastorAvailabilityLimit: async () => null }));
vi.mock("@/lib/missio/availability/service", () => ({
  addStarterTeams: async (_supabase: unknown, orgId: string) => {
    state.calls.push({ orgId });
    return { ok: true, body: { added: ["Sound"], alreadyPresent: ["Worship", "Kids", "Welcome", "Production", "Hospitality"] } };
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  state.calls = [];
});

describe("POST /api/missio/volunteers/teams/starters", () => {
  it("refuses someone who isn't a Missio pastor, before any write", async () => {
    state.access = { response: NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 }) };
    const res = await POST();
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);

    state.access = { response: NextResponse.json({ error: "Not authenticated", code: "unauthenticated" }, { status: 401 }) };
    expect((await POST()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("adds the missing teams for the pastor's org and says what was already there", async () => {
    state.access = { supabase: {}, orgId: "org-missio", user: { id: "pastor" } };
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: ["Sound"], alreadyPresent: ["Worship", "Kids", "Welcome", "Production", "Hospitality"] });
    expect(state.calls).toEqual([{ orgId: "org-missio" }]);
  });
});
