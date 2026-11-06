import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "student" } as { id: string } | null,
  canManage: false,
  enrolled: false,
  course: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const result =
        table === "enrollments"
          ? { data: h.enrolled ? [{ id: "e1" }] : [], error: null }
          : { data: h.course ? { id: "c1" } : null, error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.is = chain;
      builder.limit = chain;
      builder.maybeSingle = async () => result;
      builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
      return builder;
    },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
  userCanManageApplications: async () => false,
}));

import { POST } from "./route";

const ctx = { params: Promise.resolve({ programId: "p1", courseId: "c1" }) };
const post = () => POST(new Request("http://x", { method: "POST", body: "{}" }), ctx);

beforeEach(() => {
  h.user = { id: "student" };
  h.canManage = false;
  h.enrolled = false;
  h.course = true;
});

describe("POST course agent", () => {
  it("stays switched off for a manager and an enrolled student, and does not return course text", async () => {
    h.canManage = true;
    const manager = await post();
    expect(manager.status).toBe(501);
    const body = await manager.json();
    expect(body.error).toBe("course_agent_not_enabled");
    expect(body.material).toBeUndefined();
    expect(body.message).toMatch(/Anthropic/);

    h.canManage = false;
    h.enrolled = true;
    expect((await post()).status).toBe(501);
  });

  it("refuses someone who is not in the school", async () => {
    expect((await post()).status).toBe(403);
    h.user = null;
    expect((await post()).status).toBe(401);
  });
});
