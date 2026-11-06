import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { guardUser, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isUuid, json, previewWritesDisabled } from "@/lib/schools/lms-http";
import { enrollmentIsClosed } from "@/lib/schools/learning-course";
import { graderCapability, isLetterGrade, type GraderAssignment } from "@/lib/schools/multi-grader";
import { listGraderRowsForUser } from "@/services/course-graders";
import { getLearningCourse, postOfficialGrade } from "@/services/learning-courses";

// POST /api/schools/grades/official
//   { enrollment_id, course_id, letter_grade, notes? }
//
// Writes the one transcript letter on `grades` (unique per enrolment and
// billing course). School managers can post today. A grader can post only
// when course_graders.can_post_official is true — that table is proposed,
// so until Hub Data applies it only managers succeed.
//
// This does not replace POST /api/schools/grades. That route is what the
// grades matrix uses. This one is the authed path for training leaders,
// including program leaders, who are outside grades INSERT RLS
// (has_schools_access() is admin or unscoped schools.manage).

export async function POST(request: Request) {
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Send a grade." }, 400);
  }
  const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : "";
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!isUuid(enrollmentId) || !isUuid(courseId)) {
    return json({ error: "bad_request", message: "enrollment_id and course_id are required." }, 400);
  }
  if (!isLetterGrade(body.letter_grade)) {
    return json({ error: "bad_request", message: "letter_grade is not on the transcript scale." }, 400);
  }
  const notes = body.notes == null || body.notes === "" ? null : typeof body.notes === "string" ? body.notes.trim() : false;
  if (notes === false || (typeof notes === "string" && notes.length > 2000)) {
    return json({ error: "bad_request", message: "Notes must be text under 2000 characters." }, 400);
  }

  const admin = createAdminClient();
  const { data: enrollment, error } = await admin
    .from("enrollments")
    .select("id, program_id, removed_at, status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) return dbError(error, "Couldn't load the enrolment.");
  if (!enrollment) return json({ error: "not_found", message: "Enrolment not found." }, 404);
  if (enrollmentIsClosed(enrollment)) {
    return json({ error: "bad_request", message: "That student is no longer on this school's roster." }, 400);
  }

  const course = await getLearningCourse(admin, enrollment.program_id, courseId);
  if (course.error) return dbError(course.error, "Couldn't load the course.");
  if (!course.data) return json({ error: "bad_request", message: "That course is not in this student's school." }, 400);
  if ((course.data as { graded?: boolean }).graded === false) {
    return json({ error: "bad_request", message: "This course is not graded." }, 400);
  }

  const manager = await userCanManageProgram(guard.supabase, guard.user.id, enrollment.program_id);
  if (!manager) {
    const rows = await listGraderRowsForUser(admin, enrollment.program_id, guard.user.id);
    const assignments = (rows.data ?? []) as GraderAssignment[];
    const capability = graderCapability({
      manager: false,
      assignments,
      enrollmentId,
      courseId,
    });
    // Missing grader table, or can_post_official is false: not a manager, so no.
    if (rows.error || !capability.can_post_official) {
      return json({ error: "forbidden", message: "You cannot post the official grade." }, 403);
    }
  }

  const saved = await postOfficialGrade(admin, {
    enrollment_id: enrollmentId,
    course_id: courseId,
    letter_grade: body.letter_grade,
    notes,
    graded_by: guard.user.id,
  });
  if (saved.error) return dbError(saved.error, "Couldn't post the grade.");
  return json({ grade: saved.data });
}
