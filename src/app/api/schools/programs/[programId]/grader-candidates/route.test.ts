import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "leader" } as { id: string } | null,
  canManage: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
  userCanManageApplications: async () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/schools/grader-candidates", () => ({
  fetchGraderCandidates: async () => ({
    data: [{ id: "staff-1", first_name: "Ada", last_name: "Lovelace", preferred_name: null }],
    error: null,
  }),
}));

import { GET } from "./route";

const ctx = { params: Promise.resolve({ programId: "11111111-1111-4111-8111-111111111111" }) };

beforeEach(() => {
  h.user = { id: "leader" };
  h.canManage = true;
});

describe("GET grader candidates", () => {
  it("returns names and ids for a program manager", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toEqual([
      { id: "staff-1", first_name: "Ada", last_name: "Lovelace", preferred_name: null },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/email/);
  });

  it("refuses someone who cannot manage the school", async () => {
    h.canManage = false;
    expect((await GET(new Request("http://x"), ctx)).status).toBe(403);
  });
});
