import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/profile/household and PUT /api/profile/household/[id] — the
// server half of the marital-status rule (lib/users/marital-status.ts).
// A single person (single parents exist) may add children and dependents,
// but a spouse record is refused with a plain message. The real input
// sanitiser and rule run; only Supabase and the service writes are faked.

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  maritalStatus: "single" as string | null,
  creates: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    // Only getOwnMaritalStatus reads through the client directly.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { marital_status: state.maritalStatus },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/services/household", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/household")>();
  return {
    ...actual,
    createHouseholdMember: async (_c: unknown, _u: string, input: unknown) => {
      state.creates.push(input);
      return { data: { id: "m1", ...(input as object) }, error: null };
    },
    updateHouseholdMember: async (_c: unknown, _u: string, _id: string, input: unknown) => {
      state.updates.push(input);
      return { data: { id: "m1", ...(input as object) }, error: null };
    },
  };
});

import { POST } from "./route";
import { PUT } from "./[id]/route";

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/profile/household", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CHILD = { relationship: "child", full_name: "Sam Mokoena" };
const SPOUSE = {
  relationship: "spouse",
  first_name: "Alex",
  last_name: "Mokoena",
  email: "alex@example.com",
};
const params = { params: Promise.resolve({ id: "m1" }) };

beforeEach(() => {
  state.user = { id: "u1" };
  state.maritalStatus = "single";
  state.creates = [];
  state.updates = [];
});

describe("POST /api/profile/household", () => {
  it("accepts a child for a single person", async () => {
    const res = await POST(req("POST", CHILD));
    expect(res.status).toBe(200);
    expect(state.creates).toHaveLength(1);
  });

  it("accepts a dependent for a single person", async () => {
    const res = await POST(
      req("POST", { relationship: "dependent", full_name: "Lee Mokoena" })
    );
    expect(res.status).toBe(200);
    expect(state.creates).toHaveLength(1);
  });

  it("rejects a spouse for a single person with a plain message", async () => {
    const res = await POST(req("POST", SPOUSE));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/single/);
    expect(json.error).toMatch(/spouse can't be added/);
    expect(state.creates).toHaveLength(0);
  });

  it("still accepts a spouse for a married person", async () => {
    state.maritalStatus = "married";
    const res = await POST(req("POST", SPOUSE));
    expect(res.status).toBe(200);
    expect(state.creates).toHaveLength(1);
  });

  it("requires a login", async () => {
    state.user = null;
    const res = await POST(req("POST", CHILD));
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/profile/household/[id]", () => {
  it("lets a single person update a child", async () => {
    const res = await PUT(req("PUT", CHILD), params);
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it("refuses to turn a record into a spouse for a single person", async () => {
    const res = await PUT(req("PUT", { relationship: "spouse" }), params);
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
