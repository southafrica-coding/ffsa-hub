import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  canManage: true,
  calls: [] as string[],
  error: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/schools/program-staff-access", () => ({
  userCanManageProgramStaff: async () => h.canManage,
}));
vi.mock("@/services/program-staff", () => ({
  listProgramStaff: async () => ({ data: [], error: null }),
  switchPersonToProgramStaff: async (
    _a: unknown,
    programId: string,
    userId: string,
    actor: string
  ) => {
    h.calls.push(`${programId}:${userId}:${actor}`);
    if (h.error) return { data: null, error: { message: h.error } };
    return {
      data: { removedLeader: true, removedPermissionKeys: ["schools.manage"] },
      error: null,
    };
  },
}));

const route = await import("./route");
const ctx = { params: Promise.resolve({ programId: "p1" }) };

beforeEach(() => {
  h.canManage = true;
  h.calls = [];
  h.error = null;
});

describe("switch a person to program staff", () => {
  it("refuses someone who cannot manage the school", async () => {
    h.canManage = false;
    const res = await route.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "u1" }) }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("switches the named person and reports what was removed", async () => {
    const res = await route.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "u1" }) }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(h.calls).toEqual(["p1:u1:me"]);
    const body = await res.json();
    expect(body.switch.removedPermissionKeys).toEqual(["schools.manage"]);
  });

  it("does not switch a super admin", async () => {
    h.error = "Refusing to switch a super admin";
    const res = await route.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "boss" }) }),
      ctx
    );
    expect(res.status).toBe(400);
  });
});
