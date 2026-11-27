import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  legal: false,
  inserted: [] as Record<string, unknown>[],
  error: null as null | { code: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } }),
}));
vi.mock("@/lib/visas/access", () => ({ getVisaAccess: async () => ({ globalLegal: state.legal }) }));
vi.mock("@/services/visas", () => ({
  createVisaEmbassy: async (_s: unknown, input: Record<string, unknown>) => {
    state.inserted.push(input);
    return { data: state.error ? null : { id: "new" }, error: state.error };
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));
const good = { country_iso: "KE", name: "Test High Commission", city: "Testville" };

describe("/api/visas/embassies", () => {
  beforeEach(() => {
    state.legal = false;
    state.inserted = [];
    state.error = null;
  });

  it("only global legal adds an embassy", async () => {
    expect((await post(good)).status).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });

  it("checks the details first", async () => {
    state.legal = true;
    const res = await post({ ...good, city: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Give the city");
  });

  it("adds it; a duplicate is a 409 in words", async () => {
    state.legal = true;
    expect((await post(good)).status).toBe(200);
    expect(state.inserted[0]).toMatchObject({ country_iso: "KE", city: "Testville", is_active: true });
    state.error = { code: "23505" };
    const res = await post(good);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("That embassy is already in the list");
  });
});
