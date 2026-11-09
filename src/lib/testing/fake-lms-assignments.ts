// In-memory stand-in for src/services/lms-assignments.ts in route tests.
// It mimics what migration 310 enforces for the signed-in user: RLS
// (graders see submitted attempts in their school, students see their own,
// students see grades only once released) and the triggers (attempt
// numbering, the late rule, one draft, grade bounds, superseded grades
// frozen). The real thing is checked against Postgres in
// supabase/tests/lms_assignments_rls.sql. Test-only.

import type {
  AttemptWithDetail,
  LmsAssignment,
  LmsGrade,
  LmsSubmission,
  LmsSubmissionFile,
  SubmissionContent,
} from "@/lib/schools/lms-assignments";

type Course = { id: string; program_id: string; title: string; published: boolean };
type Enrollment = { id: string; program_id: string; user_id: string; status: string; removed_at: string | null };
type Person = { id: string; first_name: string; last_name: string };

export type LmsWorld = {
  userId: string | null;
  editors: Map<string, Set<string>>; // program → user ids
  staff: Map<string, Set<string>>;
  people: Person[];
  courses: Course[];
  enrollments: Enrollment[];
  assignments: LmsAssignment[];
  submissions: LmsSubmission[];
  files: LmsSubmissionFile[];
  grades: LmsGrade[];
  now: () => Date;
};

export function emptyWorld(): LmsWorld {
  return {
    userId: null,
    editors: new Map(),
    staff: new Map(),
    people: [],
    courses: [],
    enrollments: [],
    assignments: [],
    submissions: [],
    files: [],
    grades: [],
    now: () => new Date(),
  };
}

const err = (message: string, code: string) => ({ data: null, error: { message, code } });
let seq = 0;
let tick = 0;
const nextId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString().padStart(12, "0")}`;
};

/** 310 F5: at least one piece of content of an accepted type. */
function hasAcceptedContent(a: LmsAssignment, c: SubmissionContent, files: number) {
  return (
    (a.submission_types.includes("text") && !!c.body_text?.trim()) ||
    (a.submission_types.includes("link") && !!c.link_url) ||
    (a.submission_types.includes("file") && files > 0)
  );
}

export function createFakeLmsService(w: LmsWorld) {
  const uid = () => w.userId;
  const programOfCourse = (courseId: string) => w.courses.find((c) => c.id === courseId)?.program_id ?? null;
  const programOfAssignment = (id: string) => {
    const a = w.assignments.find((x) => x.id === id);
    return a ? programOfCourse(a.course_id) : null;
  };
  const isEditor = (p: string | null) => !!p && !!uid() && !!w.editors.get(p)?.has(uid()!);
  const isStaff = (p: string | null) => !!p && !!uid() && !!w.staff.get(p)?.has(uid()!);
  const canGrade = (p: string | null) => isEditor(p) || isStaff(p);
  const enrolled = (p: string | null) =>
    !!p &&
    w.enrollments.some(
      (e) => e.program_id === p && e.user_id === uid() && !e.removed_at && !["dismissed", "decided_to_leave"].includes(e.status)
    );
  const ownsEnrollment = (enrollmentId: string) => w.enrollments.some((e) => e.id === enrollmentId && e.user_id === uid());

  const assignmentVisible = (a: LmsAssignment) => {
    const course = w.courses.find((c) => c.id === a.course_id);
    if (!course) return false;
    if (isEditor(course.program_id)) return true;
    return a.published && course.published && (isStaff(course.program_id) || enrolled(course.program_id));
  };
  const submissionVisible = (s: LmsSubmission) =>
    (s.status === "submitted" && canGrade(programOfAssignment(s.assignment_id))) || ownsEnrollment(s.enrollment_id);
  const gradeVisible = (g: LmsGrade) => {
    const s = w.submissions.find((x) => x.id === g.submission_id);
    if (!s) return false;
    if (s.status === "submitted" && canGrade(programOfAssignment(s.assignment_id))) return true;
    return !!g.released_at && ownsEnrollment(s.enrollment_id);
  };

  const withProgram = (a: LmsAssignment) => {
    const course = w.courses.find((c) => c.id === a.course_id)!;
    return { ...a, program_id: course.program_id, course_title: course.title, course_published: course.published };
  };
  const detail = (s: LmsSubmission): AttemptWithDetail => {
    const g = w.grades.find((x) => x.submission_id === s.id);
    return {
      ...s,
      files: w.files.filter((f) => f.submission_id === s.id),
      grade: g && gradeVisible(g) ? { ...g } : null,
    };
  };

  const service = {
    async getAssignment(_c: unknown, id: string) {
      const a = w.assignments.find((x) => x.id === id);
      return { data: a && assignmentVisible(a) ? withProgram(a) : null, error: null };
    },
    async listAssignmentsForProgram(_c: unknown, programId: string, opts: { includeUnpublished: boolean }) {
      const rows = w.assignments
        .filter((a) => programOfCourse(a.course_id) === programId && assignmentVisible(a))
        .map(withProgram)
        .filter((a) => opts.includeUnpublished || (a.published && a.course_published));
      return { data: rows, error: null };
    },
    async programIdForCourse(_c: unknown, courseId: string) {
      const course = w.courses.find((c) => c.id === courseId);
      return course && (isEditor(course.program_id) || canGrade(course.program_id) || enrolled(course.program_id))
        ? course.program_id
        : null;
    },
    async createAssignment(_c: unknown, input: Omit<LmsAssignment, "id" | "created_at" | "updated_at" | "published" | "created_by"> , createdBy: string) {
      if (!isEditor(programOfCourse(input.course_id))) return err("new row violates row-level security policy", "42501");
      const row: LmsAssignment = {
        ...input,
        id: nextId(),
        published: false,
        created_by: createdBy,
        created_at: w.now().toISOString(),
        updated_at: w.now().toISOString(),
      };
      w.assignments.push(row);
      return { data: row, error: null };
    },
    async updateAssignment(_c: unknown, id: string, patch: Partial<LmsAssignment>) {
      const a = w.assignments.find((x) => x.id === id);
      if (!a || !isEditor(programOfCourse(a.course_id))) return { data: null, error: null };
      Object.assign(a, patch);
      return { data: { ...a }, error: null };
    },
    async deleteAssignment(_c: unknown, id: string) {
      const a = w.assignments.find((x) => x.id === id);
      if (!a || !isEditor(programOfCourse(a.course_id))) return { error: null };
      // 310 F2: a submitted attempt is never cascaded away.
      if (w.submissions.some((s) => s.assignment_id === id && s.status === "submitted")) {
        return { error: { message: "This assignment has submitted student work and cannot be deleted", code: "23503" } };
      }
      w.submissions = w.submissions.filter((s) => s.assignment_id !== id);
      w.assignments = w.assignments.filter((x) => x.id !== id);
      return { error: null };
    },
    async countSubmittedAttemptsForCourse(_c: unknown, courseId: string) {
      const ids = new Set(w.assignments.filter((a) => a.course_id === courseId).map((a) => a.id));
      const count = w.submissions.filter((s) => ids.has(s.assignment_id) && s.status === "submitted" && submissionVisible(s)).length;
      return { count, error: null };
    },
    async countSubmittedAttempts(_c: unknown, assignmentId: string) {
      return w.submissions.filter((s) => s.assignment_id === assignmentId && s.status === "submitted" && submissionVisible(s)).length;
    },
    async gradingRoster(_c: unknown, programId: string) {
      if (!canGrade(programId)) return { data: [], error: null };
      const rows = w.enrollments
        .filter((e) => e.program_id === programId && !e.removed_at && !["dismissed", "decided_to_leave"].includes(e.status))
        .map((e) => {
          const p = w.people.find((x) => x.id === e.user_id);
          return { enrollment_id: e.id, first_name: p?.first_name ?? null, last_name: p?.last_name ?? null, preferred_name: null, status: e.status };
        });
      return { data: rows, error: null };
    },
    async listSubmittedAttempts(_c: unknown, assignmentIds: string[]) {
      const rows = w.submissions
        .filter((s) => assignmentIds.includes(s.assignment_id) && s.status === "submitted" && submissionVisible(s))
        .sort((a, b) => b.attempt_no - a.attempt_no)
        .map(detail);
      return { data: rows, error: null };
    },
    async listAttempts(_c: unknown, assignmentId: string, enrollmentId: string) {
      const rows = w.submissions
        .filter((s) => s.assignment_id === assignmentId && s.enrollment_id === enrollmentId && submissionVisible(s))
        .sort((a, b) => b.attempt_no - a.attempt_no)
        .map(detail);
      return { data: rows, error: null };
    },
    async listAttemptsForEnrollment(_c: unknown, enrollmentId: string, assignmentIds: string[]) {
      const rows = w.submissions
        .filter((s) => s.enrollment_id === enrollmentId && assignmentIds.includes(s.assignment_id) && submissionVisible(s))
        .sort((a, b) => b.attempt_no - a.attempt_no)
        .map(detail);
      return { data: rows, error: null };
    },
    async getSubmission(_c: unknown, id: string) {
      const s = w.submissions.find((x) => x.id === id);
      return { data: s && submissionVisible(s) ? detail(s) : null, error: null };
    },
    async upsertGrade(
      _c: unknown,
      submissionId: string,
      input: { points: number; feedback: string | null; release: boolean },
      existing: LmsGrade | null,
      basedOn: string | null = existing?.updated_at ?? null
    ) {
      const s = w.submissions.find((x) => x.id === submissionId);
      // 310 F3: never your own attempt.
      if (!s || s.status !== "submitted" || !canGrade(programOfAssignment(s.assignment_id)) || ownsEnrollment(s.enrollment_id)) {
        return err("new row violates row-level security policy", "42501");
      }
      const a = w.assignments.find((x) => x.id === s.assignment_id)!;
      if (input.points < 0 || input.points > a.max_points) return err("points out of range", "23514");
      const superseded = w.submissions.some(
        (x) =>
          x.assignment_id === s.assignment_id &&
          x.enrollment_id === s.enrollment_id &&
          x.status === "submitted" &&
          x.attempt_no > s.attempt_no
      );
      const row = w.grades.find((g) => g.submission_id === submissionId);
      const releaseOnly =
        !!row && row.points === input.points && row.feedback === input.feedback && !row.released_at && input.release;
      if (superseded && !releaseOnly) {
        return err("A later attempt exists; this attempt's grade is frozen", "23514");
      }
      const now = w.now().toISOString();
      tick += 1;
      const stamp = new Date(w.now().getTime() + tick).toISOString();
      const releasedAt = input.release ? row?.released_at ?? now : existing?.released_at ?? null;
      if (row) {
        // Optimistic check: .eq("updated_at", basedOn) matches no row.
        if (!basedOn || basedOn !== row.updated_at) return { data: null, error: null, stale: true };
        Object.assign(row, { points: input.points, feedback: input.feedback, released_at: releasedAt, updated_at: stamp });
        return { data: { ...row }, error: null };
      }
      const created: LmsGrade = {
        id: nextId(),
        submission_id: submissionId,
        points: input.points,
        feedback: input.feedback,
        graded_by: uid(),
        graded_at: now,
        released_at: releasedAt,
        released_by: releasedAt ? uid() : null,
        updated_at: stamp,
      };
      w.grades.push(created);
      return { data: { ...created }, error: null };
    },
    async releaseGrades(_c: unknown, ids: string[]) {
      const out: LmsGrade[] = [];
      for (const g of w.grades) {
        if (ids.includes(g.id) && !g.released_at && gradeVisible(g)) {
          const s = w.submissions.find((x) => x.id === g.submission_id)!;
          if (!canGrade(programOfAssignment(s.assignment_id))) continue;
          g.released_at = w.now().toISOString();
          g.released_by = uid();
          tick += 1;
          g.updated_at = new Date(w.now().getTime() + tick).toISOString();
          out.push({ ...g });
        }
      }
      return { data: out, error: null };
    },
    async insertAttempt(
      _c: unknown,
      assignmentId: string,
      enrollmentId: string,
      content: SubmissionContent,
      status: "draft" | "submitted"
    ) {
      const a = w.assignments.find((x) => x.id === assignmentId);
      const e = w.enrollments.find((x) => x.id === enrollmentId);
      if (!a || !e || e.user_id !== uid() || !assignmentVisible(a) || !a.published) {
        return err("new row violates row-level security policy", "42501");
      }
      const mine = w.submissions.filter((s) => s.assignment_id === assignmentId && s.enrollment_id === enrollmentId);
      if (mine.some((s) => s.status === "draft")) return err("draft_exists: finish or delete the open draft first", "23505");
      const late = !!a.due_at && w.now().getTime() > Date.parse(a.due_at);
      if (status === "submitted" && late && !a.allow_late) return err("late_not_allowed", "23514");
      if (status === "submitted" && !hasAcceptedContent(a, content, 0)) return err("empty_submission: nothing to hand in", "23514");
      const row: LmsSubmission = {
        id: nextId(),
        assignment_id: assignmentId,
        enrollment_id: enrollmentId,
        attempt_no: mine.reduce((m, s) => Math.max(m, s.attempt_no), 0) + 1,
        ...content,
        status,
        submitted_at: status === "submitted" ? w.now().toISOString() : null,
        is_late: status === "submitted" && late,
        created_at: w.now().toISOString(),
        updated_at: w.now().toISOString(),
      };
      w.submissions.push(row);
      return { data: { ...row }, error: null };
    },
    async updateDraft(_c: unknown, draftId: string, content: SubmissionContent, status: "draft" | "submitted") {
      const s = w.submissions.find((x) => x.id === draftId);
      if (!s || s.status !== "draft" || !ownsEnrollment(s.enrollment_id)) return { data: null, error: null };
      const a = w.assignments.find((x) => x.id === s.assignment_id)!;
      const late = !!a.due_at && w.now().getTime() > Date.parse(a.due_at);
      if (status === "submitted" && late && !a.allow_late) return err("late_not_allowed", "23514");
      const files = w.files.filter((f) => f.submission_id === s.id).length;
      if (status === "submitted" && !hasAcceptedContent(a, content, files)) {
        return err("empty_submission: nothing to hand in", "23514");
      }
      Object.assign(s, content, {
        status,
        submitted_at: status === "submitted" ? w.now().toISOString() : null,
        is_late: status === "submitted" && late,
      });
      return { data: { ...s }, error: null };
    },
    async insertFileRow(_c: unknown, row: Omit<LmsSubmissionFile, "created_at">) {
      const s = w.submissions.find((x) => x.id === row.submission_id);
      if (!s || s.status !== "draft" || !ownsEnrollment(s.enrollment_id)) {
        return err("new row violates row-level security policy", "42501");
      }
      const created = { ...row, created_at: w.now().toISOString() };
      w.files.push(created);
      return { data: created, error: null };
    },
    async getFile(_c: unknown, id: string) {
      const f = w.files.find((x) => x.id === id);
      if (!f) return { data: null, error: null };
      const s = w.submissions.find((x) => x.id === f.submission_id);
      return { data: s && submissionVisible(s) ? { ...f } : null, error: null };
    },
    async deleteFileRow(_c: unknown, id: string) {
      const f = w.files.find((x) => x.id === id);
      const s = f && w.submissions.find((x) => x.id === f.submission_id);
      if (!f || !s || s.status !== "draft" || !ownsEnrollment(s.enrollment_id)) return { error: null, deleted: false };
      w.files = w.files.filter((x) => x.id !== id);
      return { error: null, deleted: true };
    },
    async deleteDraft(_c: unknown, id: string) {
      const s = w.submissions.find((x) => x.id === id);
      if (!s || s.status !== "draft" || !ownsEnrollment(s.enrollment_id)) return { error: null, deleted: false };
      w.submissions = w.submissions.filter((x) => x.id !== id);
      w.files = w.files.filter((f) => f.submission_id !== id);
      return { error: null, deleted: true };
    },
  };
  return service;
}

/** Program A with a leader, a staff member, two students; program B with its own staff. */
export function seedTwoSchools(w: LmsWorld) {
  const ids = {
    progA: "5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48",
    progB: "44444444-0000-0000-0000-444444444444",
    leaderA: "11111111-1111-1111-1111-111111111111",
    staffA: "22222222-2222-2222-2222-222222222222",
    s1: "33333333-3333-3333-3333-333333333333",
    s2: "33343334-3334-3334-3334-333433343334",
    staffB: "88888888-8888-8888-8888-888888888888",
    outsider: "66666666-6666-6666-6666-666666666666",
    e1: "e5000000-0000-0000-0000-000000000001",
    e2: "e5000000-0000-0000-0000-000000000002",
    courseA: "c1000000-0000-0000-0000-000000000001",
    courseB: "cb000000-0000-0000-0000-00000000000b",
    onTime: "a5000000-0000-0000-0000-000000000001",
    closed: "a5000000-0000-0000-0000-000000000002",
    hidden: "a5000000-0000-0000-0000-000000000003",
    lateOk: "a5000000-0000-0000-0000-000000000004",
    inB: "a5000000-0000-0000-0000-00000000000b",
  };
  const now = w.now();
  const day = 24 * 60 * 60 * 1000;
  w.editors.set(ids.progA, new Set([ids.leaderA]));
  w.staff.set(ids.progA, new Set([ids.staffA]));
  w.staff.set(ids.progB, new Set([ids.staffB]));
  w.people.push(
    { id: ids.s1, first_name: "Stu", last_name: "One" },
    { id: ids.s2, first_name: "Stu", last_name: "Two" }
  );
  w.courses.push(
    { id: ids.courseA, program_id: ids.progA, title: "Foundations", published: true },
    { id: ids.courseB, program_id: ids.progB, title: "Other", published: true }
  );
  w.enrollments.push(
    { id: ids.e1, program_id: ids.progA, user_id: ids.s1, status: "arrived", removed_at: null },
    { id: ids.e2, program_id: ids.progA, user_id: ids.s2, status: "arrived", removed_at: null }
  );
  const base = {
    lesson_id: null,
    instructions: "Write it up.",
    submission_types: ["text", "link", "file"] as LmsAssignment["submission_types"],
    max_points: 10,
    created_by: ids.leaderA,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  w.assignments.push(
    { ...base, id: ids.onTime, course_id: ids.courseA, title: "Essay", due_at: new Date(now.getTime() + day).toISOString(), allow_late: true, published: true },
    { ...base, id: ids.closed, course_id: ids.courseA, title: "Closed", due_at: new Date(now.getTime() - day).toISOString(), allow_late: false, published: true },
    { ...base, id: ids.hidden, course_id: ids.courseA, title: "Draft", due_at: null, allow_late: true, published: false },
    { ...base, id: ids.lateOk, course_id: ids.courseA, title: "Late ok", due_at: new Date(now.getTime() - day).toISOString(), allow_late: true, published: true },
    { ...base, id: ids.inB, course_id: ids.courseB, title: "B work", due_at: null, allow_late: true, published: true }
  );
  return ids;
}
