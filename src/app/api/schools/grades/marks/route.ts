import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { guardUser, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, isUuid, json, lmsSchemaNotApplied, previewWritesDisabled } from "@/lib/schools/lms-http";
import { enrollmentIsClosed } from "@/lib/schools/learning-course";
import { assignmentCovers, combineLetterGrades, isLetterGrade, type GraderAssignment } from "@/lib/schools/multi-grader";
import { listCourseGraders, listGradeMarks, listGraderRowsForUser, upsertGradeMark } from "@/services/course-graders";
import { getLearningCourse } from "@/services/learning-courses";

// GET  /api/schools/grades/marks?enrollment_id=&billing_course_id=
// POST /api/schools/grades/marks
//   { enrollment_id, billing_course_id, letter_grade, notes? }
//
// The caller records their own mark. A school manager's mark is theirs,
// not a silent overwrite of someone else. The official transcript letter
// is POST /api/schools/grades/official.
// Table grade_marks is proposed — 503 until Hub Data applies it.
//
// Students do not use this route. They already read their official grade
// through the transcript. Marker notes are visible to school managers and
// to the grader who wrote them.

export async function GET(request: Request) {
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;
  const url = new URL(request.url);
  const enrollmentId = url.searchParams.get("enrollment_id") ?? "";
  const courseId = url.searchParams.get("billing_course_id") ?? "";
  if (!isUuid(enrollmentId) || !isUuid(courseId)) {
    return json({ error: "bad_request", message: "enrollment_id and billing_course_id are required." }, 400);
  }

  const admin = createAdminClient();
  const scope = await loadScope(admin, guard, enrollmentId, courseId);
  if ("response" in scope) return scope.response;

  const marks = await listGradeMarks(admin, enrollmentId, courseId);
  if (marks.error) {
    if (isLmsSchemaMissing(marks.error)) return lmsSchemaNotApplied("Grade marks");
    return dbError(marks.error, "Couldn't load marks.");
  }
  const rows = (marks.data ?? []) as Array<{ grader_user_id: string; letter_grade: string; notes: string | null }>;
  const visible = rows.map((row) => ({
    ...row,
    notes: scope.manager || row.grader_user_id === guard.user.id ? row.notes : null,
  }));

  const assigned = scope.manager ? await assignedIds(admin, scope.programId, courseId, enrollmentId) : scope.assignments;
  const slots = combineSlots(assigned, rows);
  return json({ marks: visible, combined: combineLetterGrades(slots) });
}

export async function POST(request: Request) {
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Send a mark." }, 400);
  }
  const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : "";
  const courseId = typeof body.billing_course_id === "string" ? body.billing_course_id : "";
  if (!isUuid(enrollmentId) || !isUuid(courseId)) {
    return json({ error: "bad_request", message: "enrollment_id and billing_course_id are required." }, 400);
  }
  if (!isLetterGrade(body.letter_grade)) {
    return json({ error: "bad_request", message: "letter_grade is not on the transcript scale." }, 400);
  }
  const notes = body.notes == null || body.notes === "" ? null : typeof body.notes === "string" ? body.notes.trim() : null;
  if (notes === null && body.notes != null && body.notes !== "") {
    return json({ error: "bad_request", message: "Notes must be text." }, 400);
  }
  if (notes && notes.length > 2000) return json({ error: "bad_request", message: "Keep notes under 2000 characters." }, 400);

  const admin = createAdminClient();
  const scope = await loadScope(admin, guard, enrollmentId, courseId);
  if ("response" in scope) return scope.response;
  if (!scope.manager && !scope.assignments.some((row) => assignmentCovers(row, { enrollmentId, courseId }))) {
    return json({ error: "forbidden", message: "You are not a grader for this student." }, 403);
  }

  const saved = await upsertGradeMark(admin, {
    enrollment_id: enrollmentId,
    billing_course_id: courseId,
    grader_user_id: guard.user.id,
    letter_grade: body.letter_grade,
    notes,
  });
  if (saved.error) {
    if (isLmsSchemaMissing(saved.error)) return lmsSchemaNotApplied("Grade marks");
    return dbError(saved.error, "Couldn't save the mark.");
  }
  return json({ mark: saved.data });
}

type Scope =
  | { response: Response }
  | { manager: boolean; programId: string; assignments: GraderAssignment[] };

async function loadScope(
  admin: ReturnType<typeof createAdminClient>,
  guard: { supabase: unknown; user: { id: string } },
  enrollmentId: string,
  courseId: string
): Promise<Scope> {
  const { data: enrollment, error } = await admin
    .from("enrollments")
    .select("id, program_id, removed_at, status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) return { response: dbError(error, "Couldn't load the enrolment.") };
  if (!enrollment) return { response: json({ error: "not_found", message: "Enrolment not found." }, 404) };
  if (enrollmentIsClosed(enrollment)) {
    return { response: json({ error: "bad_request", message: "That student is no longer on this school's roster." }, 400) };
  }

  const course = await getLearningCourse(admin, enrollment.program_id, courseId);
  if (course.error) return { response: dbError(course.error, "Couldn't load the course.") };
  if (!course.data) return { response: json({ error: "bad_request", message: "That course is not in this student's school." }, 400) };
  if ((course.data as { graded?: boolean }).graded === false) {
    return { response: json({ error: "bad_request", message: "This course is not graded." }, 400) };
  }

  const manager = await userCanManageProgram(guard.supabase as never, guard.user.id, enrollment.program_id);
  if (manager) return { manager: true, programId: enrollment.program_id, assignments: [] };

  const rows = await listGraderRowsForUser(admin, enrollment.program_id, guard.user.id);
  if (rows.error) {
    if (isLmsSchemaMissing(rows.error)) return { response: lmsSchemaNotApplied("Course graders") };
    return { response: dbError(rows.error, "Couldn't check grader access.") };
  }
  const assignments = (rows.data ?? []) as GraderAssignment[];
  if (!assignments.some((row) => assignmentCovers(row, { enrollmentId, courseId }))) {
    return { response: json({ error: "forbidden", message: "You are not a grader for this student." }, 403) };
  }
  return { manager: false, programId: enrollment.program_id, assignments };
}

async function assignedIds(
  admin: ReturnType<typeof createAdminClient>,
  programId: string,
  courseId: string,
  enrollmentId: string
): Promise<GraderAssignment[]> {
  const { data, error } = await listCourseGraders(admin, programId);
  if (error || !data) return [];
  return (data as GraderAssignment[]).filter((row) => assignmentCovers(row, { enrollmentId, courseId }));
}

function combineSlots(
  assigned: GraderAssignment[],
  marks: Array<{ grader_user_id: string; letter_grade: string }>
): Array<string | null> {
  const byGrader = new Map(marks.map((mark) => [mark.grader_user_id, mark.letter_grade]));
  if (assigned.length === 0) return marks.map((mark) => mark.letter_grade);
  const seen = new Set<string>();
  const slots = assigned.map((row) => {
    seen.add(row.grader_user_id);
    return byGrader.get(row.grader_user_id) ?? null;
  });
  for (const mark of marks) {
    if (!seen.has(mark.grader_user_id)) slots.push(mark.letter_grade);
  }
  return slots;
}
