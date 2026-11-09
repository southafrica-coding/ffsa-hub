import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

// Classroom course routes: writes need userCanManageProgram; reads need
// manage, program staff, or an active enrolment.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  canManage: false,
  isStaff: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => state.canManage,
}));
vi.mock("@/lib/schools/program-staff-access", () => ({
  userIsProgramStaff: async () => state.isStaff,
}));

import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ programId: "p1" }) };

function world(opts: {
  user?: { id: string } | null;
  canManage?: boolean;
  isStaff?: boolean;
  enrollments?: Array<{ status: string; removed_at: string | null }>;
  courses?: Array<Record<string, unknown>>;
}) {
  state.canManage = opts.canManage ?? false;
  state.isStaff = opts.isStaff ?? false;
  state.fake = createFakeSupabase({
    user: opts.user === undefined ? { id: "u1" } : opts.user,
    resolve: (q: FakeQuery) => {
      if (q.table === "enrollments") return { data: opts.enrollments ?? [] };
      if (q.table === "lms_courses") return { data: opts.courses ?? [] };
      return { data: [] };
    },
  });
}

function post(body: unknown) {
  return new Request("http://hub.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schools/programs/[programId]/lms/courses", () => {
  beforeEach(() => world({}));

  it("401 when signed out", async () => {
    world({ user: null });
    const res = await POST(post({ title: "Course" }), ctx);
    expect(res.status).toBe(401);
  });

  it("403 for program staff without manage, and writes nothing", async () => {
    world({ isStaff: true });
    const res = await POST(post({ title: "Course" }), ctx);
    expect(res.status).toBe(403);
    expect(state.fake.queries.some((q) => q.table === "lms_courses")).toBe(false);
  });

  it("403 for an enrolled student", async () => {
    world({ enrollments: [{ status: "arrived", removed_at: null }] });
    const res = await POST(post({ title: "Course" }), ctx);
    expect(res.status).toBe(403);
  });

  it("400 for a manager with no title", async () => {
    world({ canManage: true });
    const res = await POST(post({ title: " " }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/schools/programs/[programId]/lms/courses", () => {
  it("403 for an outsider", async () => {
    world({});
    const res = await GET(new Request("http://hub.test/api"), ctx);
    expect(res.status).toBe(403);
  });

  it("403 for a removed student", async () => {
    world({ enrollments: [{ status: "arrived", removed_at: "2026-10-01T00:00:00Z" }] });
    const res = await GET(new Request("http://hub.test/api"), ctx);
    expect(res.status).toBe(403);
  });

  it("staff read published only (published filter is sent)", async () => {
    world({ isStaff: true, courses: [] });
    const res = await GET(new Request("http://hub.test/api"), ctx);
    expect(res.status).toBe(200);
    const q = state.fake.queries.find((x) => x.table === "lms_courses")!;
    expect(q.filters).toContainEqual({ op: "eq", args: ["published", true] });
    expect((await res.json()).canEdit).toBe(false);
  });

  it("managers read drafts (no published filter)", async () => {
    world({ canManage: true, courses: [] });
    const res = await GET(new Request("http://hub.test/api"), ctx);
    expect(res.status).toBe(200);
    const q = state.fake.queries.find((x) => x.table === "lms_courses")!;
    expect(q.filters.some((f) => f.args[0] === "published")).toBe(false);
    expect((await res.json()).canEdit).toBe(true);
  });
});
