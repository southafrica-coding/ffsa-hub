import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "lt1" } as { id: string } | null,
  allowed: true,
  updates: [] as Array<{ table: string; payload: unknown }>,
  membership: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/auth/check-okr-access", () => ({
  canUseStaffDecisions: async () => state.allowed,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain;
      q.eq = chain;
      q.maybeSingle = async () => ({
        data: { accepted: true, user_id: "student-1" },
        error: null,
      });
      q.update = (payload: unknown) => {
        state.updates.push({ table, payload });
        return q;
      };
      return q;
    },
  }),
}));

vi.mock("@/lib/users/set-membership-role", () => ({
  setMembershipRole: async () => {
    state.membership += 1;
    return { roleNames: ["staff"] };
  },
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/schools/staff-decisions/make-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.user = { id: "lt1" };
  state.allowed = true;
  state.updates = [];
  state.membership = 0;
});

describe("POST /api/schools/staff-decisions/make-staff", () => {
  it("403 for department leadership_team and does not write", async () => {
    const res = await post({ enrollment_id: "e1", department: "  leadership_team  " });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only an admin can set the department leadership_team.",
    });
    expect(state.updates).toHaveLength(0);
    expect(state.membership).toBe(0);
  });
});
