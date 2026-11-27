import { beforeEach, describe, expect, it, vi } from "vitest";

const CASE = "c0000000-0000-0000-0000-000000000001";
const EMBASSY = "e0000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  error: null as null | { code: string; message: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } }),
}));
vi.mock("@/services/visas", () => ({
  setVisaCaseEmbassy: async (_s: unknown, caseId: string, embassyId: string | null) => {
    state.calls.push([caseId, embassyId]);
    return { error: state.error };
  },
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: CASE }),
  });

describe("/api/visas/cases/[id]/embassy", () => {
  beforeEach(() => {
    state.calls = [];
    state.error = null;
  });

  it("sets or clears the embassy", async () => {
    expect((await post({ embassy_id: EMBASSY })).status).toBe(200);
    expect((await post({ embassy_id: null })).status).toBe(200);
    expect(state.calls).toEqual([
      [CASE, EMBASSY],
      [CASE, null],
    ]);
  });

  it("refuses a missing or bad id", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ embassy_id: "x" })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("passes the database's answer on", async () => {
    state.error = { code: "P0001", message: "Legal has approved your case; ask legal to change the embassy" };
    const res = await post({ embassy_id: EMBASSY });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Legal has approved your case; ask legal to change the embassy");
  });
});
