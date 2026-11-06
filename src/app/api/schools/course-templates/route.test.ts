import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  canManage: true,
  error: null as { code: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
  userCanManageApplications: async () => h.canManage,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/services/course-designs", () => ({
  listCourseTemplates: async () => ({ data: null, error: h.error }),
  insertCourseTemplate: async () => ({ data: null, error: h.error }),
}));

import { GET, POST } from "./route";

const design = {
  schema_version: 1,
  modules: [{ title: "Week 1", items: [{ kind: "page", title: "Welcome", body: "Hello." }] }],
};

beforeEach(() => {
  h.user = { id: "me" };
  h.canManage = true;
  h.error = { code: "PGRST205", message: "course_design_templates schema cache" };
});

describe("course templates API", () => {
  it("reports the proposed table as not applied, after the design has been checked", async () => {
    const res = await POST(
      new Request("http://x/api/schools/course-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Bible quarter", program_id: null, design }),
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "lms_schema_not_applied" });

    const bad = await POST(
      new Request("http://x/api/schools/course-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Bible quarter", program_id: null, design: { schema_version: 1, modules: [] } }),
      })
    );
    expect(bad.status).toBe(400);
  });

  it("does not list every school's templates for someone who is not a global manager", async () => {
    h.canManage = false;
    expect((await GET(new Request("http://x/api/schools/course-templates"))).status).toBe(403);
  });
});
