import { authorizeStudent, dbError, json } from "@/lib/schools/lms-assignments-auth";
import { buildStudentItems } from "@/lib/schools/lms-assignments";
import { listAssignmentsForProgram, listAttemptsForEnrollment } from "@/services/lms-assignments";

// GET /api/my-schools/[enrollmentId]/lms/assignments
// The signed-in student's own enrolment → published assignments in
// published courses, each with To do / Submitted / Graded, the current
// attempt, and a grade only once it is released.

type Ctx = { params: Promise<{ enrollmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { enrollmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;

  const { data: assignments, error } = await listAssignmentsForProgram(auth.supabase, auth.programId, {
    includeUnpublished: false,
  });
  if (error) return dbError(error);
  const visible = (assignments ?? []).filter((a) => a.published && a.course_published);
  const attempts = await listAttemptsForEnrollment(
    auth.supabase,
    enrollmentId,
    visible.map((a) => a.id)
  );
  if (attempts.error) return dbError(attempts.error);
  return json({ items: buildStudentItems(visible, attempts.data ?? []) });
}
