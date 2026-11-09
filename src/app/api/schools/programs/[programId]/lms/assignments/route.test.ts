import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, lmsTestState, resetLmsWorld } from "@/lib/testing/lms-route-mocks";
import { seedTwoSchools } from "@/lib/testing/fake-lms-assignments";

// Staff-side assignment routes plus the full submit → grade → release →
// resubmit loop across the student routes. Services are the in-memory
// fake that mimics migration 310's RLS and triggers.

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/testing/lms-route-mocks")).serverClientMock());
vi.mock("@/lib/schools/program-staff-access", async () =>
  (await import("@/lib/testing/lms-route-mocks")).programViewerMock()
);
vi.mock("@/services/lms-assignments", async () => (await import("@/lib/testing/lms-route-mocks")).serviceMock());
vi.mock("@/lib/schools/lms-storage", async () => (await import("@/lib/testing/lms-route-mocks")).storageMock());

import { GET as listAssignments, POST as createAssignment } from "./route";
import { DELETE as deleteAssignment, PATCH as patchAssignment } from "./[assignmentId]/route";
import { GET as listSubmissions } from "./[assignmentId]/submissions/route";
import { GET as studentHistory } from "./[assignmentId]/students/[enrollmentId]/route";
import { POST as releaseGrades } from "./[assignmentId]/release/route";
import { PUT as putGrade } from "../submissions/[submissionId]/grade/route";
import { GET as staffDownload } from "../files/[fileId]/route";
import { GET as studentList } from "@/app/api/my-schools/[enrollmentId]/lms/assignments/route";
import { GET as studentDetail } from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/route";
import { POST as studentSubmit } from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/submit/route";
import { POST as studentUpload } from "@/app/api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]/files/route";

let ids: ReturnType<typeof seedTwoSchools>;
const as = (userId: string | null) => {
  lmsTestState.world.userId = userId;
};
const p = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  // Route late checks use the real clock; pin it to the fake world's now.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
  ids = seedTwoSchools(resetLmsWorld());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("staff assignment routes: access", () => {
  it("401 signed out", async () => {
    as(null);
    expect((await listAssignments(jsonRequest("GET"), p({ programId: ids.progA }))).status).toBe(401);
  });

  it("403 for a non-member (outsider, a student, and staff of another school)", async () => {
    for (const user of [ids.outsider, ids.s1, ids.staffB]) {
      as(user);
      const res = await listAssignments(jsonRequest("GET"), p({ programId: ids.progA }));
      expect(res.status, user).toBe(403);
    }
  });

  it("staff can list and grade but not create or edit assignments", async () => {
    as(ids.staffA);
    const list = await listAssignments(jsonRequest("GET"), p({ programId: ids.progA }));
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.canEdit).toBe(false);
    // Published only: the draft assignment is not listed for staff.
    expect(body.assignments.map((a: { title: string }) => a.title).sort()).toEqual(["Closed", "Essay", "Late ok"]);
    const create = await createAssignment(
      jsonRequest("POST", { course_id: ids.courseA, title: "X", max_points: 5 }),
      p({ programId: ids.progA })
    );
    expect(create.status).toBe(403);
    const patch = await patchAssignment(jsonRequest("PATCH", { title: "Y" }), p({ programId: ids.progA, assignmentId: ids.onTime }));
    expect(patch.status).toBe(403);
  });

  it("404 cross-program: an assignment or course of school B under school A's URL", async () => {
    as(ids.leaderA);
    const res = await listSubmissions(jsonRequest("GET"), p({ programId: ids.progA, assignmentId: ids.inB }));
    expect(res.status).toBe(404);
    const create = await createAssignment(
      jsonRequest("POST", { course_id: ids.courseB, title: "X", max_points: 5 }),
      p({ programId: ids.progA })
    );
    expect(create.status).toBe(404);
  });

  it("leader creates and publishes; bad input is a 400", async () => {
    as(ids.leaderA);
    const bad = await createAssignment(
      jsonRequest("POST", { course_id: ids.courseA, title: "X", max_points: 0 }),
      p({ programId: ids.progA })
    );
    expect(bad.status).toBe(400);
    const res = await createAssignment(
      jsonRequest("POST", { course_id: ids.courseA, title: "Reflection", max_points: 20, submission_types: ["text", "file"] }),
      p({ programId: ids.progA })
    );
    expect(res.status).toBe(201);
    const { assignment } = await res.json();
    expect(assignment.published).toBe(false);
    const pub = await patchAssignment(jsonRequest("PATCH", { published: true }), p({ programId: ids.progA, assignmentId: assignment.id }));
    expect(pub.status).toBe(200);
    expect((await pub.json()).assignment.published).toBe(true);
  });
});

describe("submit → grade → release → resubmit", () => {
  async function submitAsS1(body: Record<string, unknown>, assignmentId = ids.onTime) {
    as(ids.s1);
    return studentSubmit(jsonRequest("POST", body), p({ enrollmentId: ids.e1, assignmentId }));
  }

  it("student submits text, a link and a file; staff grade and release; the student sees it", async () => {
    // File: register on the draft, "upload", then submit with text + link.
    as(ids.s1);
    const up = await studentUpload(
      jsonRequest("POST", { file_name: "essay.pdf", mime: "application/pdf", size_bytes: 1000 }),
      p({ enrollmentId: ids.e1, assignmentId: ids.onTime })
    );
    expect(up.status).toBe(201);
    const { upload, file } = await up.json();
    expect(upload.path).toMatch(new RegExp(`^${ids.progA}/${ids.onTime}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.pdf$`));
    expect(upload.path).not.toContain(ids.s1);

    // Submit before the upload lands → 409.
    const early = await submitAsS1({ body_text: "My essay", link_url: "https://example.org/essay" });
    expect(early.status).toBe(409);
    lmsTestState.uploaded.add(upload.path);

    const res = await submitAsS1({ body_text: "My essay", link_url: "https://example.org/essay" });
    expect(res.status).toBe(201);
    const { attempt } = await res.json();
    expect(attempt.attempt_no).toBe(1);
    expect(attempt.status).toBe("submitted");

    // Staff sees it as submitted and can download through a signed URL.
    as(ids.staffA);
    const table = await (await listSubmissions(jsonRequest("GET"), p({ programId: ids.progA, assignmentId: ids.onTime }))).json();
    expect(table.rows.find((r: { enrollment_id: string }) => r.enrollment_id === ids.e1).status).toBe("submitted");
    expect(table.rows.find((r: { enrollment_id: string }) => r.enrollment_id === ids.e2).status).toBe("missing");
    const dl = await staffDownload(jsonRequest("GET"), p({ programId: ids.progA, fileId: file.id }));
    expect(dl.status).toBe(200);
    expect((await dl.json()).url).toContain("ttl=300");

    // Staff grade (held) → student cannot see it.
    const grade = await putGrade(
      jsonRequest("PUT", { points: 8, feedback: "Good" }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(grade.status).toBe(200);
    as(ids.s1);
    let detail = await (await studentDetail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(detail.attempts[0].grade).toBeNull();
    let list = await (await studentList(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).json();
    expect(list.items.find((i: { assignment: { id: string } }) => i.assignment.id === ids.onTime).bucket).toBe("submitted");

    // Staff release → student sees 8 / 10 and the feedback.
    as(ids.staffA);
    const rel = await releaseGrades(jsonRequest("POST", { submission_id: attempt.id }), p({ programId: ids.progA, assignmentId: ids.onTime }));
    expect((await rel.json()).released).toBe(1);
    as(ids.s1);
    detail = await (await studentDetail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(detail.attempts[0].grade).toMatchObject({ points: 8, feedback: "Good" });
    list = await (await studentList(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).json();
    const item = list.items.find((i: { assignment: { id: string } }) => i.assignment.id === ids.onTime);
    expect(item.bucket).toBe("graded");
    expect(item.grade.points).toBe(8);
  });

  it("a leader can grade and release too (release all)", async () => {
    const { attempt } = await (await submitAsS1({ body_text: "Answer" })).json();
    as(ids.leaderA);
    const grade = await putGrade(jsonRequest("PUT", { points: 10 }), p({ programId: ids.progA, submissionId: attempt.id }));
    expect(grade.status).toBe(200);
    const rel = await releaseGrades(jsonRequest("POST"), p({ programId: ids.progA, assignmentId: ids.onTime }));
    expect((await rel.json()).released).toBe(1);
    as(ids.s1);
    const detail = await (await studentDetail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(detail.attempts[0].grade.points).toBe(10);
  });

  it("points outside 0..max are a 400; staff of another school get 403", async () => {
    const { attempt } = await (await submitAsS1({ body_text: "Answer" })).json();
    as(ids.staffA);
    expect((await putGrade(jsonRequest("PUT", { points: 11 }), p({ programId: ids.progA, submissionId: attempt.id }))).status).toBe(400);
    expect((await putGrade(jsonRequest("PUT", { points: -1 }), p({ programId: ids.progA, submissionId: attempt.id }))).status).toBe(400);
    as(ids.staffB);
    expect((await putGrade(jsonRequest("PUT", { points: 5 }), p({ programId: ids.progA, submissionId: attempt.id }))).status).toBe(403);
    // Under their own school's URL the attempt does not exist for them.
    expect((await putGrade(jsonRequest("PUT", { points: 5 }), p({ programId: ids.progB, submissionId: attempt.id }))).status).toBe(404);
  });

  it("resubmit after release creates attempt 2; attempt 1 and its grade stay; attempt 2 graded separately", async () => {
    const first = (await (await submitAsS1({ body_text: "First" })).json()).attempt;
    as(ids.staffA);
    await putGrade(jsonRequest("PUT", { points: 6, feedback: "Try again", release: true }), p({ programId: ids.progA, submissionId: first.id }));

    const res = await submitAsS1({ body_text: "Second" });
    expect(res.status).toBe(201);
    const second = (await res.json()).attempt;
    expect(second.attempt_no).toBe(2);

    as(ids.s1);
    const detail = await (await studentDetail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(detail.current_submission_id).toBe(second.id);
    expect(detail.attempts.map((a: { attempt_no: number }) => a.attempt_no)).toEqual([2, 1]);
    expect(detail.attempts[1]).toMatchObject({ body_text: "First", grade: { points: 6, feedback: "Try again" } });
    expect(detail.attempts[0].grade).toBeNull();

    as(ids.staffA);
    const table = await (await listSubmissions(jsonRequest("GET"), p({ programId: ids.progA, assignmentId: ids.onTime }))).json();
    const row = table.rows.find((r: { enrollment_id: string }) => r.enrollment_id === ids.e1);
    expect(row).toMatchObject({ status: "submitted", attempts: 2, current: { attempt_no: 2 } });
    const history = await (await studentHistory(jsonRequest("GET"), p({ programId: ids.progA, assignmentId: ids.onTime, enrollmentId: ids.e1 }))).json();
    expect(history.attempts).toHaveLength(2);

    // Attempt 1's grade is frozen; attempt 2 takes its own grade.
    const frozen = await putGrade(jsonRequest("PUT", { points: 9 }), p({ programId: ids.progA, submissionId: first.id }));
    expect(frozen.status).toBe(409);
    const g2 = await putGrade(jsonRequest("PUT", { points: 9, release: true }), p({ programId: ids.progA, submissionId: second.id }));
    expect(g2.status).toBe(200);
    const g1 = lmsTestState.world.grades.find((g) => g.submission_id === first.id);
    expect(g1?.points).toBe(6);
  });

  it("deleting an assignment with student work is a 409", async () => {
    await submitAsS1({ body_text: "Answer" });
    as(ids.leaderA);
    const res = await deleteAssignment(jsonRequest("DELETE"), p({ programId: ids.progA, assignmentId: ids.onTime }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("has_student_work");
  });
});
