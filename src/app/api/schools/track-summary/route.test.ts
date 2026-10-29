import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  user: { id: "u1" } as { id: string } | null,
  scopes: { globalLevel: "manage" as "manage" | "view" | null, programLevels: {} as Record<string, string> },
  programs: [] as Array<{ id: string; name: string; code: string }>,
  segmented: new Set<string>(),
  inFlight: 0,
  maxInFlight: 0,
  programFilter: null as string[] | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/schools-count-scopes", () => ({
  getSchoolsCountScopes: async () => state.scopes,
}));
vi.mock("@/services/schools-analytics", () => ({
  getScopedPrograms: async (_c: unknown, ids: string[] | null) => {
    state.programFilter = ids;
    return { data: ids ? state.programs.filter((p) => ids.includes(p.id)) : state.programs, error: null };
  },
}));
vi.mock("@/lib/schools/track-pipeline", () => ({
  loadTrackPipeline: async (_admin: unknown, programId: string) => {
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    // Later programs finish first, to prove the output keeps program order.
    await new Promise((r) => setTimeout(r, 30 - state.programs.findIndex((p) => p.id === programId) * 5));
    state.inFlight--;
    return state.segmented.has(programId)
      ? { segments: [{ id: `s-${programId}` }], people: [{ programId }] }
      : { segments: [], people: [] };
  },
  summariseAcceptedTrack: (people: Array<{ programId: string }>) => ({ summaryFor: people[0].programId }),
}));

import { GET } from "./route";

beforeEach(() => {
  state.user = { id: "u1" };
  state.scopes = { globalLevel: "manage", programLevels: {} };
  state.programs = [
    { id: "p1", name: "A School", code: "A" },
    { id: "p2", name: "B School", code: "B" },
    { id: "p3", name: "C School", code: "C" },
    { id: "p4", name: "D School", code: "D" },
  ];
  state.segmented = new Set(["p1", "p3", "p4"]);
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.programFilter = null;
});

describe("GET /api/schools/track-summary", () => {
  it("summarises segmented schools in program order, skipping the rest", async () => {
    const body = await (await GET()).json();
    expect(body.programs).toEqual([
      { id: "p1", name: "A School", code: "A", summaryFor: "p1" },
      { id: "p3", name: "C School", code: "C", summaryFor: "p3" },
      { id: "p4", name: "D School", code: "D", summaryFor: "p4" },
    ]);
  });

  it("loads the schools side by side, not one after another", async () => {
    await GET();
    expect(state.maxInFlight).toBe(4);
  });

  it("a program-scoped viewer only gets their programs", async () => {
    state.scopes = { globalLevel: null, programLevels: { p3: "view" } };
    const body = await (await GET()).json();
    expect(state.programFilter).toEqual(["p3"]);
    expect(body.programs.map((p: { id: string }) => p.id)).toEqual(["p3"]);
  });

  it("401 when signed out, 403 with no schools access", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
    state.user = { id: "u1" };
    state.scopes = { globalLevel: null, programLevels: {} };
    expect((await GET()).status).toBe(403);
  });
});
