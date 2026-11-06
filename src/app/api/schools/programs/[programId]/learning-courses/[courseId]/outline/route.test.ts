import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "student" } as { id: string } | null,
  canManage: false,
  read: false,
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
vi.mock("@/services/learning-courses", () => ({
  getLearningCourse: async () => {
    h.read = true;
    return { data: { id: "c1" }, error: null };
  },
}));
vi.mock("@/services/course-designs", () => ({
  getCourseOutline: async () => {
    h.read = true;
    return { data: { design: { secret: true } }, error: null };
  },
  getCourseTemplate: async () => ({ data: null, error: null }),
  saveCourseOutline: async () => ({ data: null, error: null }),
}));

import { GET } from "./route";

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const COURSE = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ programId: PROGRAM, courseId: COURSE }) };

beforeEach(() => {
  h.user = { id: "student" };
  h.canManage = false;
  h.read = false;
});

describe("GET course outline", () => {
  it("does not give a student the staff design", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(403);
    expect(h.read).toBe(false);
    expect(await res.json()).not.toHaveProperty("outline");
  });

  it("returns the outline to someone who can manage the school", async () => {
    h.canManage = true;
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).outline.design).toEqual({ secret: true });
  });
});
