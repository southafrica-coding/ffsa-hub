import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, lmsTestState, resetLmsWorld } from "@/lib/testing/lms-route-mocks";
import { seedTwoSchools } from "@/lib/testing/fake-lms-assignments";

// Preview-write guard (ported from #501) on every LMS write route, slice 1
// (courses, modules, lessons, reorders) and slice 2 (assignments), plus the
// DB-error → HTTP mapping the routes share.

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/testing/lms-route-mocks")).serverClientMock());
vi.mock("@/lib/schools/program-staff-access", async () =>
  (await import("@/lib/testing/lms-route-mocks")).programViewerMock()
);
vi.mock("@/services/lms-assignments", async () => (await import("@/lib/testing/lms-route-mocks")).serviceMock());
vi.mock("@/lib/schools/lms-storage", async () => (await import("@/lib/testing/lms-route-mocks")).storageMock());

import { previewWritesDisabled } from "./lms-http";
import { dbError, lmsRestrictMessage } from "./lms-assignments-auth";
import * as draft from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/draft/route";
import * as files from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/files/route";
import * as file from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/files/[fileId]/route";
import * as submit from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/submit/route";
import * as assignments from "@/app/api/schools/programs/[programId]/lms/assignments/route";
import * as assignment from "@/app/api/schools/programs/[programId]/lms/assignments/[assignmentId]/route";
import * as release from "@/app/api/schools/programs/[programId]/lms/assignments/[assignmentId]/release/route";
import * as grade from "@/app/api/schools/programs/[programId]/lms/submissions/[submissionId]/grade/route";
// Slice 1 (course content).
import * as courses from "@/app/api/schools/programs/[programId]/lms/courses/route";
import * as coursesReorder from "@/app/api/schools/programs/[programId]/lms/courses/reorder/route";
import * as course from "@/app/api/schools/programs/[programId]/lms/courses/[courseId]/route";
import * as modules from "@/app/api/schools/programs/[programId]/lms/courses/[courseId]/modules/route";
import * as modulesReorder from "@/app/api/schools/programs/[programId]/lms/courses/[courseId]/modules/reorder/route";
import * as mod from "@/app/api/schools/programs/[programId]/lms/modules/[moduleId]/route";
import * as lessons from "@/app/api/schools/programs/[programId]/lms/modules/[moduleId]/lessons/route";
import * as lessonsReorder from "@/app/api/schools/programs/[programId]/lms/modules/[moduleId]/lessons/reorder/route";
import * as lesson from "@/app/api/schools/programs/[programId]/lms/lessons/[lessonId]/route";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ids = {
  enrollmentId: "e5000000-0000-0000-0000-000000000001",
  assignmentId: "a5000000-0000-0000-0000-000000000001",
  programId: "5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48",
  fileId: "f1000000-0000-0000-0000-000000000001",
  submissionId: "5b000000-0000-0000-0000-000000000001",
  courseId: "c1000000-0000-0000-0000-000000000001",
  moduleId: "d1000000-0000-0000-0000-000000000001",
  lessonId: "e1000000-0000-0000-0000-000000000001",
};

const WRITES: Array<[string, Handler, string]> = [
  ["draft PUT", draft.PUT as unknown as Handler, "PUT"],
  ["draft DELETE", draft.DELETE as unknown as Handler, "DELETE"],
  ["files POST", files.POST as unknown as Handler, "POST"],
  ["file DELETE", file.DELETE as unknown as Handler, "DELETE"],
  ["submit POST", submit.POST as unknown as Handler, "POST"],
  ["assignments POST", assignments.POST as unknown as Handler, "POST"],
  ["assignment PATCH", assignment.PATCH as unknown as Handler, "PATCH"],
  ["assignment DELETE", assignment.DELETE as unknown as Handler, "DELETE"],
  ["release POST", release.POST as unknown as Handler, "POST"],
  ["grade PUT", grade.PUT as unknown as Handler, "PUT"],
  // Slice 1: course / module / lesson content and every reorder.
  ["course POST", courses.POST as unknown as Handler, "POST"],
  ["courses reorder POST", coursesReorder.POST as unknown as Handler, "POST"],
  ["course PATCH", course.PATCH as unknown as Handler, "PATCH"],
  ["course DELETE", course.DELETE as unknown as Handler, "DELETE"],
  ["module POST", modules.POST as unknown as Handler, "POST"],
  ["modules reorder POST", modulesReorder.POST as unknown as Handler, "POST"],
  ["module PATCH", mod.PATCH as unknown as Handler, "PATCH"],
  ["module DELETE", mod.DELETE as unknown as Handler, "DELETE"],
  ["lesson POST", lessons.POST as unknown as Handler, "POST"],
  ["lessons reorder POST", lessonsReorder.POST as unknown as Handler, "POST"],
  ["lesson PATCH", lesson.PATCH as unknown as Handler, "PATCH"],
  ["lesson DELETE", lesson.DELETE as unknown as Handler, "DELETE"],
];

const ctx = () => ({ params: Promise.resolve({ ...ids }) });

beforeEach(() => {
  seedTwoSchools(resetLmsWorld());
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("previewWritesDisabled", () => {
  it("is a 403 on preview and null elsewhere", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = previewWritesDisabled();
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ error: "preview_writes_disabled" });
    vi.stubEnv("VERCEL_ENV", "production");
    expect(previewWritesDisabled()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "");
    expect(previewWritesDisabled()).toBeNull();
  });

  it.each(WRITES)("%s returns 403 preview_writes_disabled on a preview deployment", async (_name, handler, method) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    lmsTestState.world.userId = "11111111-1111-1111-1111-111111111111";
    const res = await handler(jsonRequest(method, {}), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("preview_writes_disabled");
    // Nothing reached the data layer.
    expect(lmsTestState.world.submissions).toHaveLength(0);
  });

  it.each(WRITES)("%s is not blocked when VERCEL_ENV is unset", async (_name, handler, method) => {
    vi.stubEnv("VERCEL_ENV", "");
    lmsTestState.world.userId = null; // signed out → the normal 401
    const res = await handler(jsonRequest(method, {}), ctx());
    expect(res.status).toBe(401);
  });

  it("reads stay open on a preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    lmsTestState.world.userId = "11111111-1111-1111-1111-111111111111";
    const res = await assignments.GET(jsonRequest("GET"), { params: Promise.resolve({ programId: ids.programId }) });
    expect(res.status).toBe(200);
    // Slice-1 reads are not guarded either: signed out they reach the normal 401.
    lmsTestState.world.userId = null;
    for (const read of [courses.GET, course.GET] as unknown as Handler[]) {
      expect((await read(jsonRequest("GET"), ctx())).status).toBe(401);
    }
  });
});

describe("dbError / lmsRestrictMessage", () => {
  it("names the thing being deleted", () => {
    const f2 = { code: "23503", message: "This assignment has submitted student work and cannot be deleted" };
    expect(lmsRestrictMessage(f2, "assignment")).toMatch(/this assignment/);
    expect(lmsRestrictMessage(f2, "course")).toMatch(/This course/);
    expect(lmsRestrictMessage({ code: "23503", message: 'violates foreign key constraint on table "lms_submissions"' }, "enrollment")).toMatch(/enrolment/);
    expect(lmsRestrictMessage({ code: "23503", message: "lms_grades" }, "program")).toMatch(/school/);
    expect(lmsRestrictMessage({ code: "23503", message: "lms_grades" })).toMatch(/submitted student work/);
    // Someone else's foreign key is not ours to explain.
    expect(lmsRestrictMessage({ code: "23503", message: "grade_marks" }, "course")).toBeNull();
  });

  it("maps codes to statuses", async () => {
    expect(dbError({ code: "23503", message: "has submitted student work" }, "assignment").status).toBe(409);
    expect(dbError({ code: "23505", message: "duplicate key value violates unique constraint" }).status).toBe(409);
    expect((await dbError({ code: "23505", message: "draft_exists: x" }).json()).error).toBe("draft_exists");
    expect(dbError({ code: "23514", message: "empty_submission: hand in at least one of text" }).status).toBe(400);
    expect(dbError({ code: "23514", message: "late_not_allowed" }).status).toBe(409);
    expect(dbError({ code: "23514", message: "A later attempt exists; this attempt's grade is frozen" }).status).toBe(409);
    expect(dbError({ code: "42501", message: "rls" }).status).toBe(403);
    expect(dbError({ code: "PGRST205", message: "Could not find the table 'public.lms_assignments'" }).status).toBe(503);
  });
});
