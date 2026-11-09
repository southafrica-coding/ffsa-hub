import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ canManage: true, created: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/services/schools", () => ({
  createQuestion: async () => {
    h.created += 1;
    return { data: { id: "q1" }, error: null };
  },
  updateQuestion: async () => ({ data: null, error: null }),
  deleteQuestion: async () => ({ error: null }),
}));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
  h.created = 0;
});

function post() {
  return route.POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ program_id: "p1", label: "Why" }),
    })
  );
}

describe("application form edits", () => {
  it("lets a leader save a question", async () => {
    expect((await post()).status).toBe(200);
    expect(h.created).toBe(1);
  });

  it("refuses program staff, who are not program managers", async () => {
    h.canManage = false;
    expect((await post()).status).toBe(403);
    expect(h.created).toBe(0);
  });
});
