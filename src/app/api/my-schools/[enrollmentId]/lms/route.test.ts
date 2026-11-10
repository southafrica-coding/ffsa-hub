import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

// Student classroom read: own, active enrolment only; published content only.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));

import { GET } from "./route";

const ctx = { params: Promise.resolve({ enrollmentId: "e1" }) };
const at = "2026-11-09T00:00:00Z";

// Deliberately returns drafts too, as if RLS had regressed, so the test
// proves the route filters on its own.
const COURSES = [
  { id: "c1", program_id: "p1", title: "Published", description: null, sort_order: 0, published: true, created_by: null, created_at: at, updated_at: at },
  { id: "c2", program_id: "p1", title: "Draft", description: null, sort_order: 1, published: false, created_by: null, created_at: at, updated_at: at },
];
const MODULES = [
  { id: "m1", course_id: "c1", title: "M1", sort_order: 0, published: true, created_at: at, updated_at: at },
  { id: "m2", course_id: "c1", title: "M2 draft", sort_order: 1, published: false, created_at: at, updated_at: at },
];
const LESSONS = [
  { id: "l1", module_id: "m1", title: "L1", content_type: "rich_text", body: "Hi", link_url: null, sort_order: 0, published: true, created_at: at, updated_at: at },
  { id: "l2", module_id: "m1", title: "L2 draft", content_type: "link", body: null, link_url: "https://a.test", sort_order: 1, published: false, created_at: at, updated_at: at },
  { id: "l3", module_id: "m2", title: "L3", content_type: "rich_text", body: "x", link_url: null, sort_order: 0, published: true, created_at: at, updated_at: at },
];

function world(opts: { user?: { id: string } | null; enrollment?: Record<string, unknown> | null }) {
  state.fake = createFakeSupabase({
    user: opts.user === undefined ? { id: "student" } : opts.user,
    resolve: (q: FakeQuery) => {
      if (q.table === "enrollments") {
        return {
          data:
            opts.enrollment === undefined
              ? { id: "e1", program_id: "p1", user_id: "student", status: "arrived", removed_at: null }
              : opts.enrollment,
        };
      }
      if (q.table === "lms_courses") return { data: COURSES };
      if (q.table === "lms_modules") return { data: MODULES };
      if (q.table === "lms_lessons") return { data: LESSONS };
      return { data: [] };
    },
  });
}

describe("GET /api/my-schools/[enrollmentId]/lms", () => {
  beforeEach(() => world({}));

  it("401 when signed out", async () => {
    world({ user: null });
    expect((await GET(new Request("http://hub.test"), ctx)).status).toBe(401);
  });

  it("404 when the enrolment is not visible", async () => {
    world({ enrollment: null });
    expect((await GET(new Request("http://hub.test"), ctx)).status).toBe(404);
  });

  it("403 for someone else's enrolment, without reading content", async () => {
    world({ user: { id: "intruder" } });
    const res = await GET(new Request("http://hub.test"), ctx);
    expect(res.status).toBe(403);
    expect(state.fake.queries.some((q) => q.table.startsWith("lms_"))).toBe(false);
  });

  it("403 for a removed or dismissed enrolment", async () => {
    world({ enrollment: { id: "e1", program_id: "p1", user_id: "student", status: "arrived", removed_at: at } });
    expect((await GET(new Request("http://hub.test"), ctx)).status).toBe(403);
    world({ enrollment: { id: "e1", program_id: "p1", user_id: "student", status: "dismissed", removed_at: null } });
    expect((await GET(new Request("http://hub.test"), ctx)).status).toBe(403);
  });

  it("200 with published content only", async () => {
    const res = await GET(new Request("http://hub.test"), ctx);
    expect(res.status).toBe(200);
    const { courses } = await res.json();
    expect(courses.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(courses[0].modules.map((m: { id: string }) => m.id)).toEqual(["m1"]);
    expect(courses[0].modules[0].lessons.map((l: { id: string }) => l.id)).toEqual(["l1"]);
    const courseQuery = state.fake.queries.find((q) => q.table === "lms_courses")!;
    expect(courseQuery.filters).toContainEqual({ op: "eq", args: ["program_id", "p1"] });
  });
});
