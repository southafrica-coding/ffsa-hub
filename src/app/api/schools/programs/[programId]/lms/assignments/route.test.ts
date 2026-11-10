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

  it("re-grading needs the updated_at you edited; a stale edit is a 409 and changes nothing", async () => {
    const { attempt } = await (await submitAsS1({ body_text: "Answer" })).json();
    as(ids.staffA);
    const first = await putGrade(
      jsonRequest("PUT", { points: 5, expected_updated_at: null }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(first.status).toBe(200);
    const g1 = (await first.json()).grade;

    // A leader re-grades from the same starting point.
    as(ids.leaderA);
    const leader = await putGrade(
      jsonRequest("PUT", { points: 6, expected_updated_at: g1.updated_at }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(leader.status).toBe(200);

    // Staff saves an edit based on the old version → 409, leader's 6 stays.
    as(ids.staffA);
    const stale = await putGrade(
      jsonRequest("PUT", { points: 9, expected_updated_at: g1.updated_at }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("grade_changed");
    // Someone graded while this grader still saw no grade → 409 too.
    const blind = await putGrade(
      jsonRequest("PUT", { points: 9, expected_updated_at: null }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(blind.status).toBe(409);
    expect(lmsTestState.world.grades.find((g) => g.submission_id === attempt.id)?.points).toBe(6);
  });

  it("a grader enrolled in the school cannot grade their own attempt", async () => {
    // Staff A is also a student of A here.
    lmsTestState.world.enrollments.push({
      id: "e5000000-0000-0000-0000-0000000000aa",
      program_id: ids.progA,
      user_id: ids.staffA,
      status: "arrived",
      removed_at: null,
    });
    as(ids.staffA);
    const own = await (
      await studentSubmit(
        jsonRequest("POST", { body_text: "mine" }),
        p({ enrollmentId: "e5000000-0000-0000-0000-0000000000aa", assignmentId: ids.onTime })
      )
    ).json();
    const res = await putGrade(jsonRequest("PUT", { points: 10 }), p({ programId: ids.progA, submissionId: own.attempt.id }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_allowed");
    expect(lmsTestState.world.grades).toHaveLength(0);
  });

  it("deleting an assignment with student work is a 409", async () => {
    await submitAsS1({ body_text: "Answer" });
    as(ids.leaderA);
    const res = await deleteAssignment(jsonRequest("DELETE"), p({ programId: ids.progA, assignmentId: ids.onTime }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("has_student_work");
    expect(body.message).toMatch(/this assignment/);
    // The submitted attempt is still there.
    expect(lmsTestState.world.submissions.some((s) => s.assignment_id === ids.onTime)).toBe(true);
  });
});

describe("grading refusals vs real conflicts", () => {
  const ownEnrollment = "e5000000-0000-0000-0000-0000000000aa";

  /** Staff A is also a student of A; they hand in, and the leader grades it. */
  async function ownAttemptGradedByLeader() {
    lmsTestState.world.enrollments.push({
      id: ownEnrollment,
      program_id: ids.progA,
      user_id: ids.staffA,
      status: "arrived",
      removed_at: null,
    });
    as(ids.staffA);
    const { attempt } = await (
      await studentSubmit(jsonRequest("POST", { body_text: "mine" }), p({ enrollmentId: ownEnrollment, assignmentId: ids.onTime }))
    ).json();
    as(ids.leaderA);
    const leader = await putGrade(jsonRequest("PUT", { points: 4 }), p({ programId: ids.progA, submissionId: attempt.id }));
    expect(leader.status).toBe(200);
    return { attemptId: attempt.id as string, grade: (await leader.json()).grade as { updated_at: string } };
  }

  it("re-grading your own attempt after someone else graded it is 403 not_allowed, not 409", async () => {
    const { attemptId, grade } = await ownAttemptGradedByLeader();
    as(ids.staffA);
    for (const body of [
      { points: 10, expected_updated_at: grade.updated_at }, // up to date: the UPDATE matches 0 rows under RLS
      { points: 10 }, // no optimistic check sent
      { points: 10, expected_updated_at: null }, // stale view, but it is still their own work
    ]) {
      const res = await putGrade(jsonRequest("PUT", body), p({ programId: ids.progA, submissionId: attemptId }));
      expect(res.status, JSON.stringify(body)).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("not_allowed");
      expect(json.message).toMatch(/your own work/);
    }
    expect(lmsTestState.world.grades.find((g) => g.submission_id === attemptId)?.points).toBe(4);
  });

  it("a 0-row update is 409 grade_changed when updated_at really moved in between", async () => {
    as(ids.s1);
    const { attempt } = await (
      await studentSubmit(jsonRequest("POST", { body_text: "Answer" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))
    ).json();
    as(ids.leaderA);
    const g1 = (await (await putGrade(jsonRequest("PUT", { points: 5 }), p({ programId: ids.progA, submissionId: attempt.id }))).json()).grade;

    // Another grader saves between this request's read and its UPDATE.
    const real = lmsTestState.service.upsertGrade;
    lmsTestState.service.upsertGrade = async (...args: Parameters<typeof real>) => {
      const row = lmsTestState.world.grades.find((g) => g.submission_id === attempt.id)!;
      Object.assign(row, { points: 7, updated_at: "2026-11-09T10:05:00.000Z" });
      return real(...args);
    };
    as(ids.staffA);
    const res = await putGrade(
      jsonRequest("PUT", { points: 9, expected_updated_at: g1.updated_at }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("grade_changed");
    expect(lmsTestState.world.grades.find((g) => g.submission_id === attempt.id)?.points).toBe(7);
  });

  it("a 0-row update with updated_at unchanged is a refusal (403), not a conflict", async () => {
    as(ids.s1);
    const { attempt } = await (
      await studentSubmit(jsonRequest("POST", { body_text: "Answer" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))
    ).json();
    as(ids.leaderA);
    const g1 = (await (await putGrade(jsonRequest("PUT", { points: 5 }), p({ programId: ids.progA, submissionId: attempt.id }))).json()).grade;

    // RLS hides the row from the UPDATE for some reason other than self-grading.
    lmsTestState.service.upsertGrade = async () => ({ data: null, error: null, stale: true });
    as(ids.staffA);
    const res = await putGrade(
      jsonRequest("PUT", { points: 9, expected_updated_at: g1.updated_at }),
      p({ programId: ids.progA, submissionId: attempt.id })
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("not_allowed");
    expect(json.message).not.toMatch(/your own work/);
  });
});

describe("file names and types", () => {
  const upload = (body: Record<string, unknown>) => {
    as(ids.s1);
    return studentUpload(jsonRequest("POST", body), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }));
  };

  it("a name that disagrees with its type is a 400 file_type_mismatch and creates nothing", async () => {
    const res = await upload({ file_name: "payload.exe", mime: "application/pdf", size_bytes: 1000 });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("file_type_mismatch");
    expect(json.message).toMatch(/\.pdf/);
    expect(lmsTestState.world.submissions).toHaveLength(0);
    expect(lmsTestState.world.files).toHaveLength(0);
  });

  it("an Android HEIF photo uploads, stored as image/heic", async () => {
    const res = await upload({ file_name: "IMG_20261110.heif", mime: "image/heif", size_bytes: 1000 });
    expect(res.status).toBe(201);
    const { file, upload: up } = await res.json();
    expect(file.mime).toBe("image/heic");
    expect(up.path).toMatch(/\.heic$/);
  });

  it("the grader's download is named for the stored type, whatever the stored name says", async () => {
    const res = await upload({ file_name: "My Essay.pdf", mime: "application/pdf", size_bytes: 1000 });
    const { file, upload: up } = await res.json();
    lmsTestState.uploaded.add(up.path);
    as(ids.s1);
    expect(
      (await studentSubmit(jsonRequest("POST", { body_text: "x" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).status
    ).toBe(201);

    as(ids.staffA);
    expect((await staffDownload(jsonRequest("GET"), p({ programId: ids.progA, fileId: file.id }))).status).toBe(200);
    // A row whose name slipped past the check (e.g. written before it existed).
    lmsTestState.world.files.find((f) => f.id === file.id)!.file_name = "payload.exe";
    expect((await staffDownload(jsonRequest("GET"), p({ programId: ids.progA, fileId: file.id }))).status).toBe(200);
    expect(lmsTestState.downloadNames).toEqual(["My Essay.pdf", "payload.pdf"]);
  });
});
