import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  canManage: true,
  calls: [] as string[],
  person: { id: "u1", is_active: true } as { id: string; is_active: boolean } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.person, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/schools/program-staff-access", () => ({
  userCanManageProgramStaff: async () => h.canManage,
}));
vi.mock("@/services/program-staff", () => ({
  listProgramStaff: async () => ({ data: [{ id: "s1", user_id: "u1" }], error: null }),
  addProgramStaff: async (_a: unknown, programId: string, userId: string, actor: string) => {
    h.calls.push(`add:${programId}:${userId}:${actor}`);
    return { error: null };
  },
  removeProgramStaff: async (_a: unknown, programId: string, userId: string) => {
    h.calls.push(`remove:${programId}:${userId}`);
    return { error: null };
  },
}));

const route = await import("./route");
const ctx = { params: Promise.resolve({ programId: "p1" }) };
const req = (method: string, body?: unknown) =>
  new Request("http://x/api/schools/programs/p1/staff", {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  h.canManage = true;
  h.calls = [];
  h.person = { id: "u1", is_active: true };
});

describe("program staff API", () => {
  it("lets a manager add and remove staff", async () => {
    expect((await route.POST(req("POST", { userId: "u1" }), ctx)).status).toBe(200);
    expect((await route.DELETE(req("DELETE", { userId: "u1" }), ctx)).status).toBe(200);
    expect(h.calls).toEqual(["add:p1:u1:me", "remove:p1:u1"]);
  });

  it("refuses someone who cannot manage the program", async () => {
    h.canManage = false;
    expect((await route.POST(req("POST", { userId: "u1" }), ctx)).status).toBe(403);
    expect((await route.DELETE(req("DELETE", { userId: "u1" }), ctx)).status).toBe(403);
    expect((await route.GET(req("GET"), ctx)).status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("requires a userId", async () => {
    expect((await route.POST(req("POST", {}), ctx)).status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("refuses a missing or deactivated person", async () => {
    h.person = null;
    const missing = await route.POST(req("POST", { userId: "u1" }), ctx);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/Hub account/);

    h.person = { id: "u1", is_active: false };
    const inactive = await route.POST(req("POST", { userId: "u1" }), ctx);
    expect(inactive.status).toBe(400);
    expect((await inactive.json()).error).toMatch(/deactivated/);
    expect(h.calls).toEqual([]);
  });
});
