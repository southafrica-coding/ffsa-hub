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
    _supabase: unknown,
    programId: string,
    userId: string
  ) => {
    h.calls.push(`${programId}:${userId}`);
    if (h.error) {
      const status = h.error.includes("super admin")
        ? 400
        : h.error.includes("An admin is needed")
          ? 403
          : 500;
      return { data: null, error: { message: h.error, status } };
    }
    return {
      data: { removed_leader: true, removed_assignable: true },
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
    expect(h.calls).toEqual(["p1:u1"]);
    const body = await res.json();
    expect(body.switch.removed_assignable).toBe(true);
  });

  it("tells a leader an admin is needed when the person holds other school permissions", async () => {
    h.error = "An admin is needed to move this person to staff. They have other school permissions on this program (schools.manage).";
    const res = await route.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "u1" }) }),
      ctx
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/An admin is needed/);
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
