import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding / removing a school leader keeps the school_leader role (migration
// 292, bookings.request) in sync — grant on add, revoke-if-orphaned on
// remove — and only after the program_leaders write succeeded.

const h = vi.hoisted(() => ({
  canManage: true,
  writeError: null as { message: string } | null,
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/services/program-leaders", () => ({
  listProgramLeaders: async () => ({ data: [] }),
  addProgramLeader: async (_a: unknown, p: string, u: string) => {
    h.calls.push(`add:${p}:${u}`);
    return { error: h.writeError };
  },
  removeProgramLeader: async (_a: unknown, p: string, u: string) => {
    h.calls.push(`remove:${p}:${u}`);
    return { error: h.writeError };
  },
}));
vi.mock("@/lib/schools/school-leader-role", () => ({
  ensureSchoolLeaderRole: async (_a: unknown, u: string, by: string) => {
    h.calls.push(`grant:${u}:${by}`);
  },
  revokeSchoolLeaderRoleIfOrphaned: async (_a: unknown, u: string) => {
    h.calls.push(`revoke:${u}`);
  },
}));

const route = await import("./route");

const req = (method: string, body: unknown) =>
  new Request("http://x/api/schools/programs/p1/leaders", {
    method,
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ programId: "p1" }) };

beforeEach(() => {
  h.canManage = true;
  h.writeError = null;
  h.calls = [];
});

describe("program leaders API — school_leader role sync", () => {
  it("POST adds the leader, then grants the role", async () => {
    const res = await route.POST(req("POST", { userId: "u1" }), ctx);
    expect(res.status).toBe(200);
    expect(h.calls).toEqual(["add:p1:u1", "grant:u1:me"]);
  });

  it("DELETE removes the leader, then revokes only if orphaned", async () => {
    const res = await route.DELETE(req("DELETE", { userId: "u1" }), ctx);
    expect(res.status).toBe(200);
    expect(h.calls).toEqual(["remove:p1:u1", "revoke:u1"]);
  });

  it("does not touch roles when the membership write fails", async () => {
    h.writeError = { message: "boom" };
    expect((await route.POST(req("POST", { userId: "u1" }), ctx)).status).toBe(500);
    expect((await route.DELETE(req("DELETE", { userId: "u1" }), ctx)).status).toBe(500);
    expect(h.calls).toEqual(["add:p1:u1", "remove:p1:u1"]);
  });

  it("does nothing for someone who cannot manage the program", async () => {
    h.canManage = false;
    expect((await route.POST(req("POST", { userId: "u1" }), ctx)).status).toBe(403);
    expect(h.calls).toEqual([]);
  });
});
