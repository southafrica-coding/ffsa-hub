import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "leader" } as { id: string } | null,
  canManage: true,
  graded: true as boolean | undefined,
  posted: null as Record<string, unknown> | null,
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "e1", program_id: "p1" }, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/services/learning-courses", () => ({
  getLearningCourse: async () => ({
    data: h.graded === undefined ? { id: "c1" } : { id: "c1", graded: h.graded },
    error: null,
  }),
  postOfficialGrade: async (_client: unknown, row: Record<string, unknown>) => {
    h.posted = row;
    return { data: { id: "g1", ...row }, error: null };
  },
}));
vi.mock("@/services/course-graders", () => ({
  listGraderRowsForUser: async () => ({ data: [], error: { code: "PGRST205", message: "course_graders" } }),
}));

import { POST } from "./route";

const enrollment = "11111111-1111-4111-8111-111111111111";
const course = "22222222-2222-4222-8222-222222222222";

const post = (body: unknown) =>
  POST(new Request("http://x/api/schools/grades/official", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.user = { id: "leader" };
  h.canManage = true;
  h.graded = true;
  h.posted = null;
});

describe("POST /api/schools/grades/official", () => {
  it("lets a school manager post the transcript letter", async () => {
    const res = await post({ enrollment_id: enrollment, course_id: course, letter_grade: "B+", notes: "Steady." });
    expect(res.status).toBe(200);
    expect(h.posted).toMatchObject({ letter_grade: "B+", graded_by: "leader", course_id: course });
  });

  it("refuses a letter that is not on the scale, an ungraded course, and a non-manager", async () => {
    expect((await post({ enrollment_id: enrollment, course_id: course, letter_grade: "Z" })).status).toBe(400);
    h.graded = false;
    expect((await post({ enrollment_id: enrollment, course_id: course, letter_grade: "A" })).status).toBe(400);
    h.graded = true;
    h.canManage = false;
    expect((await post({ enrollment_id: enrollment, course_id: course, letter_grade: "A" })).status).toBe(403);
    expect(h.posted).toBeNull();
  });
});
