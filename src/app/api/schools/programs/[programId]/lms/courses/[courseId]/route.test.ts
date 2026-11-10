import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";

// Course DELETE must not cascade away submitted assignment work (slice 2,
// migration 310): pre-check → 409, with the DB's 23503 as the backstop.

const state = vi.hoisted(() => ({
  submitted: 0,
  countError: null as { code: string; message: string } | null,
  deleteError: null as { code: string; message: string } | null,
  deleted: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeSupabase({ user: { id: "leader" } }).client,
}));
vi.mock("@/services/lms-content", () => ({
  resolveLmsAccess: async () => ({ canEdit: true, canReadPublished: true }),
  programIdForCourse: async () => "p1",
  deleteCourse: async (_s: unknown, id: string) => {
    if (state.deleteError) return { error: state.deleteError };
    state.deleted.push(id);
    return { error: null };
  },
  getCourseTree: async () => ({ data: null, error: null }),
  updateCourse: async () => ({ data: null, error: null }),
}));
vi.mock("@/services/lms-assignments", () => ({
  countSubmittedAttemptsForCourse: async () => ({ count: state.submitted, error: state.countError }),
}));

import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ programId: "p1", courseId: "c1" }) };
const del = () => DELETE(new Request("http://hub.test/api", { method: "DELETE" }), ctx);

beforeEach(() => {
  state.submitted = 0;
  state.countError = null;
  state.deleteError = null;
  state.deleted = [];
});

describe("DELETE …/lms/courses/[courseId]", () => {
  it("409 before deleting when any assignment has submitted work", async () => {
    state.submitted = 2;
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("has_student_work");
    expect(body.error).toMatch(/This course has assignments with submitted student work/);
    expect(state.deleted).toEqual([]);
  });

  it("409 from the 310 delete guard (23503) as a backstop", async () => {
    state.deleteError = { code: "23503", message: "This assignment has submitted student work and cannot be deleted" };
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/This course/);
  });

  it("deletes when nothing has been submitted", async () => {
    expect((await del()).status).toBe(200);
    expect(state.deleted).toEqual(["c1"]);
  });

  it("still deletes before 310 is applied (lms_submissions missing)", async () => {
    state.countError = { code: "PGRST205", message: "Could not find the table 'public.lms_submissions'" };
    expect((await del()).status).toBe(200);
  });

  it("500 on any other read error, without deleting", async () => {
    state.countError = { code: "XX000", message: "boom" };
    expect((await del()).status).toBe(500);
    expect(state.deleted).toEqual([]);
  });
});
