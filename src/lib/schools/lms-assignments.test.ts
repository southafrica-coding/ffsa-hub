import { describe, expect, it } from "vitest";
import {
  buildGradingRows,
  buildStudentItems,
  buildSubmissionPath,
  countStatuses,
  downloadFileName,
  FILE_ACCEPT_ATTR,
  fileNameMatchesMime,
  currentAttempt,
  formatDue,
  fromJohannesburgInput,
  gradingStatus,
  isPastDue,
  lateDecision,
  mimeFromFileName,
  resolveFileMime,
  openDraft,
  releasedOnly,
  safeHref,
  studentBucket,
  submitPlan,
  toJohannesburgInput,
  validateAssignmentInput,
  validateAssignmentPatch,
  validateGradeInput,
  validatePoints,
  validateSubmissionContent,
  validateSubmissionTypes,
  validateUploadRequest,
  type AttemptWithDetail,
  type LmsGrade,
} from "./lms-assignments";

const NOW = new Date("2026-11-09T10:00:00Z");
const PAST = "2026-11-08T10:00:00Z";
const FUTURE = "2026-11-10T10:00:00Z";

const P = "5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48";
const A = "a5000000-0000-0000-0000-000000000001";
const S = "5b000000-0000-0000-0000-000000000001";
const O = "0f0f0f0f-0000-4000-8000-000000000001";
const USER = "33333333-3333-3333-3333-333333333333";

describe("late rule", () => {
  it("no due date is never late", () => {
    expect(isPastDue(null, NOW)).toBe(false);
    expect(lateDecision({ due_at: null, allow_late: false }, NOW)).toEqual({ allowed: true, late: false });
  });

  it("before the due date: allowed, not late, for both switch values", () => {
    expect(lateDecision({ due_at: FUTURE, allow_late: true }, NOW)).toEqual({ allowed: true, late: false });
    expect(lateDecision({ due_at: FUTURE, allow_late: false }, NOW)).toEqual({ allowed: true, late: false });
  });

  it("allow_late = true past due: accepted and marked late", () => {
    expect(lateDecision({ due_at: PAST, allow_late: true }, NOW)).toEqual({ allowed: true, late: true });
  });

  it("allow_late = false past due: refused", () => {
    expect(lateDecision({ due_at: PAST, allow_late: false }, NOW)).toEqual({ allowed: false, late: true });
  });

  it("exactly at the due instant is still on time", () => {
    expect(isPastDue("2026-11-09T10:00:00Z", NOW)).toBe(false);
  });
});

describe("points bounds 0..max", () => {
  it("accepts 0, max, and decimals in between", () => {
    expect(validatePoints(0, 10)).toEqual({ ok: true, value: 0 });
    expect(validatePoints(10, 10)).toEqual({ ok: true, value: 10 });
    expect(validatePoints("7.5", 10)).toEqual({ ok: true, value: 7.5 });
  });

  it("rejects negatives, above max, and non-numbers", () => {
    expect(validatePoints(-0.5, 10).ok).toBe(false);
    expect(validatePoints(10.01, 10).ok).toBe(false);
    expect(validatePoints("ten", 10).ok).toBe(false);
    expect(validatePoints(null, 10).ok).toBe(false);
    expect(validatePoints(Number.NaN, 10).ok).toBe(false);
  });

  it("grade input carries feedback and the release flag", () => {
    expect(validateGradeInput({ points: 8, feedback: " Good ", release: true }, 10)).toEqual({
      ok: true,
      value: { points: 8, feedback: "Good", release: true },
    });
    expect(validateGradeInput({ points: 11 }, 10).ok).toBe(false);
    expect(validateGradeInput({ points: 5, release: "yes" }, 10).ok).toBe(false);
  });
});

describe("submission types", () => {
  it("keeps a non-empty subset in canonical order", () => {
    expect(validateSubmissionTypes(["file", "text", "file"])).toEqual({ ok: true, value: ["text", "file"] });
  });

  it("rejects empty and unknown types", () => {
    expect(validateSubmissionTypes([]).ok).toBe(false);
    expect(validateSubmissionTypes(["video"]).ok).toBe(false);
    expect(validateSubmissionTypes("text").ok).toBe(false);
  });

  it("assignment input needs a course, a title and points > 0", () => {
    const course_id = "c1000000-0000-0000-0000-000000000001";
    expect(validateAssignmentInput({ course_id, title: "Essay", max_points: 0 }).ok).toBe(false);
    expect(validateAssignmentInput({ title: "Essay", max_points: 10 }).ok).toBe(false);
    const ok = validateAssignmentInput({
      course_id,
      title: " Essay ",
      max_points: "20",
      submission_types: ["link"],
      due_at: "2026-11-20T15:00:00+02:00",
      allow_late: false,
    });
    expect(ok).toEqual({
      ok: true,
      value: {
        course_id,
        title: "Essay",
        instructions: null,
        due_at: "2026-11-20T13:00:00.000Z",
        allow_late: false,
        submission_types: ["link"],
        max_points: 20,
        lesson_id: null,
      },
    });
  });

  it("patch refuses a course move and empty patches", () => {
    expect(validateAssignmentPatch({ course_id: "x" }).ok).toBe(false);
    expect(validateAssignmentPatch({}).ok).toBe(false);
    expect(validateAssignmentPatch({ published: true })).toEqual({ ok: true, value: { published: true } });
  });

  it("content must match the allowed types", () => {
    expect(validateSubmissionContent({ body_text: "hi" }, ["link"], { submitting: true, fileCount: 0 }).ok).toBe(false);
    expect(validateSubmissionContent({ link_url: "https://x.test" }, ["text"], { submitting: true, fileCount: 0 }).ok).toBe(false);
    expect(validateSubmissionContent({}, ["text"], { submitting: false, fileCount: 1 }).ok).toBe(false);
  });

  it("refuses javascript: links and empty submits; drafts may be empty", () => {
    expect(validateSubmissionContent({ link_url: "javascript:alert(1)" }, ["link"], { submitting: false, fileCount: 0 }).ok).toBe(false);
    expect(validateSubmissionContent({ body_text: "   " }, ["text"], { submitting: true, fileCount: 0 }).ok).toBe(false);
    expect(validateSubmissionContent({}, ["text"], { submitting: false, fileCount: 0 })).toEqual({
      ok: true,
      value: { body_text: null, link_url: null },
    });
    expect(validateSubmissionContent({}, ["file"], { submitting: true, fileCount: 2 }).ok).toBe(true);
  });
});

describe("current attempt", () => {
  const attempts = [
    { id: "1", attempt_no: 1, status: "submitted" as const },
    { id: "3", attempt_no: 3, status: "draft" as const },
    { id: "2", attempt_no: 2, status: "submitted" as const },
  ];

  it("is the highest submitted attempt; drafts never count", () => {
    expect(currentAttempt(attempts)?.id).toBe("2");
    expect(currentAttempt([{ attempt_no: 1, status: "draft" as const }])).toBeNull();
    expect(currentAttempt([])).toBeNull();
    expect(openDraft(attempts)?.id).toBe("3");
  });

  it("submit fills the open draft, else creates attempt N+1", () => {
    expect(submitPlan(attempts)).toEqual({ kind: "submit_draft", draftId: "3" });
    expect(submitPlan(attempts.filter((a) => a.status === "submitted"))).toEqual({ kind: "new_attempt", attemptNo: 3 });
    expect(submitPlan([])).toEqual({ kind: "new_attempt", attemptNo: 1 });
  });
});

describe("status", () => {
  it("grading status from current attempt and grade", () => {
    expect(gradingStatus(null, null)).toBe("missing");
    expect(gradingStatus({ is_late: false }, null)).toBe("submitted");
    expect(gradingStatus({ is_late: true }, null)).toBe("late");
    expect(gradingStatus({ is_late: true }, { released_at: null })).toBe("graded");
    expect(gradingStatus({ is_late: false }, { released_at: PAST })).toBe("released");
    expect(countStatuses(["missing", "late", "late", "released"])).toEqual({
      total: 4,
      missing: 1,
      submitted: 0,
      late: 2,
      graded: 0,
      released: 1,
    });
  });

  it("student bucket only counts a released grade", () => {
    expect(studentBucket(null, null)).toBe("todo");
    expect(studentBucket({ status: "submitted" }, null)).toBe("submitted");
    expect(studentBucket({ status: "submitted" }, { released_at: null })).toBe("submitted");
    expect(studentBucket({ status: "submitted" }, { released_at: PAST })).toBe("graded");
  });

  it("releasedOnly strips an unreleased grade", () => {
    const grade: LmsGrade = {
      id: "g",
      submission_id: "s",
      points: 5,
      feedback: "secret",
      graded_by: null,
      graded_at: PAST,
      released_at: null,
      released_by: null,
      updated_at: PAST,
    };
    expect(releasedOnly({ grade }).grade).toBeNull();
    expect(releasedOnly({ grade: { ...grade, released_at: PAST } }).grade?.points).toBe(5);
  });
});

describe("row builders", () => {
  const base = { assignment_id: A, is_late: false, submitted_at: PAST, status: "submitted" as const };
  const attempts = [
    { ...base, id: "s1", enrollment_id: "e1", attempt_no: 1, grade: { id: "g1", points: 8, released_at: PAST } },
    { ...base, id: "s2", enrollment_id: "e1", attempt_no: 2, grade: null, is_late: true },
    { ...base, id: "s3", enrollment_id: "e2", attempt_no: 1, grade: { id: "g3", points: 4, released_at: null } },
  ];
  const roster = [
    { enrollment_id: "e1", first_name: "Stu", last_name: "One", preferred_name: null },
    { enrollment_id: "e2", first_name: "Stuart", last_name: "Two", preferred_name: "Stu" },
    { enrollment_id: "e3", first_name: null, last_name: null, preferred_name: null },
  ];

  it("grading rows follow the current attempt per student", () => {
    const rows = buildGradingRows(roster, attempts, A);
    expect(rows.map((r) => [r.name, r.status, r.attempts, r.current?.attempt_no ?? null])).toEqual([
      ["Stu One", "late", 2, 2],
      ["Stu Two", "graded", 1, 1],
      ["Unnamed student", "missing", 0, null],
    ]);
  });

  it("student items: to do / submitted / graded, overdue and closed", () => {
    const assignments = [
      { id: "a1", title: "One", due_at: PAST, allow_late: false, submission_types: ["text" as const], max_points: 10, course_id: "c" },
      { id: "a2", title: "Two", due_at: FUTURE, allow_late: true, submission_types: ["text" as const], max_points: 10, course_id: "c" },
      { id: "a3", title: "Three", due_at: null, allow_late: true, submission_types: ["text" as const], max_points: 10, course_id: "c" },
    ];
    const mk = (id: string, assignment_id: string, attempt_no: number, grade: LmsGrade | null): AttemptWithDetail => ({
      id,
      assignment_id,
      enrollment_id: "e1",
      attempt_no,
      body_text: "x",
      link_url: null,
      status: "submitted",
      submitted_at: PAST,
      is_late: false,
      created_at: PAST,
      updated_at: PAST,
      files: [],
      grade,
    });
    const g = (released_at: string | null): LmsGrade => ({
      id: "g",
      submission_id: "s",
      points: 9,
      feedback: "ok",
      graded_by: null,
      graded_at: PAST,
      released_at,
      released_by: null,
      updated_at: PAST,
    });
    const items = buildStudentItems(
      assignments,
      [mk("s2", "a2", 1, g(null)), mk("s3a", "a3", 1, g(PAST)), mk("s3b", "a3", 2, null)],
      NOW
    );
    expect(items.map((i) => [i.assignment.id, i.bucket, i.overdue, i.closed, i.grade?.points ?? null])).toEqual([
      ["a1", "todo", true, true, null],
      ["a2", "submitted", false, false, null], // unreleased grade never shown
      ["a3", "submitted", false, false, null], // resubmitted: attempt 2 is current and ungraded
    ]);
  });
});

describe("files", () => {
  it("path is ids only and never a user id", () => {
    const path = buildSubmissionPath({ programId: P, assignmentId: A, submissionId: S, objectId: O, ext: "pdf" });
    expect(path).toBe(`${P}/${A}/${S}/${O}.pdf`);
    expect(path).not.toContain(USER);
    expect(path).not.toMatch(/@/);
  });

  it("path builder refuses non-uuid parts (an email or a name)", () => {
    expect(() =>
      buildSubmissionPath({ programId: P, assignmentId: A, submissionId: "stu@example.org", objectId: O, ext: "pdf" })
    ).toThrow();
    expect(() => buildSubmissionPath({ programId: P, assignmentId: A, submissionId: S, objectId: O, ext: "../x" })).toThrow();
  });

  it("upload requests: allowlist, 20 MB, 10 files", () => {
    expect(validateUploadRequest({ file_name: "a.pdf", mime: "application/pdf", size_bytes: 1000 }, 0)).toEqual({
      ok: true,
      value: { file_name: "a.pdf", mime: "application/pdf", size_bytes: 1000, ext: "pdf" },
    });
    expect(validateUploadRequest({ file_name: "a.exe", mime: "application/x-msdownload", size_bytes: 10 }, 0).ok).toBe(false);
    expect(validateUploadRequest({ file_name: "a.pdf", mime: "application/pdf", size_bytes: 20 * 1024 * 1024 + 1 }, 0).ok).toBe(false);
    expect(validateUploadRequest({ file_name: "a.pdf", mime: "application/pdf", size_bytes: 10 }, 10).ok).toBe(false);
  });
});

describe("mime fallback (phones send HEIC / Office with an empty type)", () => {
  it("derives the mime from the extension", () => {
    expect(mimeFromFileName("IMG_0001.HEIC")).toBe("image/heic");
    expect(mimeFromFileName("photo.jpeg")).toBe("image/jpeg");
    expect(mimeFromFileName("talk.pptx")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(mimeFromFileName("essay.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeFromFileName("virus.exe")).toBeNull();
    expect(mimeFromFileName("noext")).toBeNull();
  });

  it("keeps a good browser type, falls back on empty / octet-stream, refuses a bad one", () => {
    expect(resolveFileMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(resolveFileMime("a.heic", "")).toBe("image/heic");
    expect(resolveFileMime("a.docx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(resolveFileMime("a.pdf", "application/x-msdownload")).toBeNull();
  });

  it("upload validation uses the fallback", () => {
    expect(validateUploadRequest({ file_name: "IMG_1.heic", mime: "", size_bytes: 10 }, 0)).toEqual({
      ok: true,
      value: { file_name: "IMG_1.heic", mime: "image/heic", size_bytes: 10, ext: "heic" },
    });
    expect(validateUploadRequest({ file_name: "a.exe", mime: "", size_bytes: 10 }, 0).ok).toBe(false);
  });
});

describe("file name must match its type", () => {
  it("refuses a name whose extension disagrees with the declared type (file_type_mismatch)", () => {
    const r = validateUploadRequest({ file_name: "payload.exe", mime: "application/pdf", size_bytes: 10 }, 0);
    expect(r).toMatchObject({ ok: false, code: "file_type_mismatch" });
    expect(!r.ok && r.error).toMatch(/\.pdf/);
    expect(validateUploadRequest({ file_name: "photo.png", mime: "image/jpeg", size_bytes: 10 }, 0)).toMatchObject({
      ok: false,
      code: "file_type_mismatch",
    });
    // No extension at all does not match either.
    expect(validateUploadRequest({ file_name: "notes", mime: "text/plain", size_bytes: 10 }, 0)).toMatchObject({
      ok: false,
      code: "file_type_mismatch",
    });
  });

  it("accepts any extension of the same type, in any case", () => {
    expect(validateUploadRequest({ file_name: "Essay.PDF", mime: "application/pdf", size_bytes: 10 }, 0).ok).toBe(true);
    expect(validateUploadRequest({ file_name: "photo.jpeg", mime: "image/jpeg", size_bytes: 10 }, 0)).toMatchObject({
      ok: true,
      value: { mime: "image/jpeg", ext: "jpg" },
    });
    expect(fileNameMatchesMime("a.jpg", "image/jpeg")).toBe(true);
    expect(fileNameMatchesMime("a.exe", "application/pdf")).toBe(false);
    expect(fileNameMatchesMime("a.exe", "application/x-msdownload")).toBe(false);
  });

  it("an unknown type is still the plain allowlist error, not a mismatch", () => {
    const r = validateUploadRequest({ file_name: "a.exe", mime: "application/x-msdownload", size_bytes: 10 }, 0);
    expect(r.ok).toBe(false);
    expect("code" in r).toBe(false);
  });
});

describe("download names", () => {
  it("always end in the stored type's extension, never the uploaded one", () => {
    expect(downloadFileName("payload.exe", "application/pdf")).toBe("payload.pdf");
    expect(downloadFileName("Essay v1.2 final.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "Essay v1.2 final.docx"
    );
    expect(downloadFileName("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(downloadFileName("trick.pdf.exe", "application/pdf")).toBe("trick.pdf.pdf");
  });

  it("cleans the base name", () => {
    expect(downloadFileName("../../etc/passwd", "text/plain")).toBe("passwd.txt");
    expect(downloadFileName("C:\\Users\\me\\notes.txt", "text/plain")).toBe("notes.txt");
    expect(downloadFileName('a"b\r\n<c>|d?.pdf', "application/pdf")).toBe("a b c d.pdf");
    expect(downloadFileName("", "application/pdf")).toBe("submission.pdf");
    expect(downloadFileName("...", "application/pdf")).toBe("submission.pdf");
    expect(downloadFileName(`${"x".repeat(300)}.pdf`, "application/pdf")).toBe(`${"x".repeat(100)}.pdf`);
  });
});

describe("Android HEIF counts as HEIC", () => {
  it("maps image/heif and .heif to image/heic before the allowlist", () => {
    expect(resolveFileMime("IMG_20261110.heif", "image/heif")).toBe("image/heic");
    expect(resolveFileMime("IMG_20261110.heic", "image/heif")).toBe("image/heic");
    expect(resolveFileMime("IMG_20261110.HEIF", "")).toBe("image/heic");
    expect(resolveFileMime("IMG_20261110.heif", " IMAGE/HEIF ")).toBe("image/heic");
  });

  it("an Android HEIF photo passes upload validation and downloads as .heic", () => {
    expect(validateUploadRequest({ file_name: "IMG_20261110.heif", mime: "image/heif", size_bytes: 10 }, 0)).toEqual({
      ok: true,
      value: { file_name: "IMG_20261110.heif", mime: "image/heic", size_bytes: 10, ext: "heic" },
    });
    expect(downloadFileName("IMG_20261110.heif", "image/heic")).toBe("IMG_20261110.heic");
  });

  it("the file picker offers HEIF", () => {
    const accept = FILE_ACCEPT_ATTR.split(",");
    expect(accept).toContain("image/heif");
    expect(accept).toContain(".heif");
    expect(accept).toContain(".heic");
    expect(accept).toContain(".jpeg");
  });
});

describe("display helpers", () => {
  it("formatDue shows the year in Johannesburg time", () => {
    const out = formatDue("2026-12-31T22:30:00Z"); // 1 Jan 2027, 00:30 SAST
    expect(out).toContain("2027");
    expect(out).toMatch(/Jan/);
    expect(formatDue(null)).toBe("No due date");
  });

  it("safeHref allows http(s) only", () => {
    expect(safeHref("https://example.org/a")).toBe("https://example.org/a");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("due dates round-trip in Africa/Johannesburg", () => {
    expect(fromJohannesburgInput("2026-11-20T15:00")).toBe("2026-11-20T13:00:00.000Z");
    expect(toJohannesburgInput("2026-11-20T13:00:00.000Z")).toBe("2026-11-20T15:00");
    expect(fromJohannesburgInput("")).toBeNull();
  });
});
