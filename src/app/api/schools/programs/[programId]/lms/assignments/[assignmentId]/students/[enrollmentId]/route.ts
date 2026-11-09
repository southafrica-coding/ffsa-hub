import { authorizeAssignments, dbError, json, notFound } from "@/lib/schools/lms-assignments-auth";
import { currentAttempt, studentName } from "@/lib/schools/lms-assignments";
import { getAssignment, gradingRoster, listAttempts } from "@/services/lms-assignments";

// GET …/lms/assignments/[assignmentId]/students/[enrollmentId]
// Attempt history for one student: every submitted attempt, newest first,
// with its text, link, files and grade. RLS hides drafts from graders.

type Ctx = { params: Promise<{ programId: string; assignmentId: string; enrollmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, assignmentId, enrollmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;
  const { data: assignment, error } = await getAssignment(auth.supabase, assignmentId);
  if (error) return dbError(error);
  if (!assignment || assignment.program_id !== programId) return notFound("Assignment");

  const roster = await gradingRoster(auth.supabase, programId);
  if (roster.error) return dbError(roster.error);
  const student = (roster.data ?? []).find((r) => r.enrollment_id === enrollmentId);
  if (!student) return notFound("Student");

  const { data, error: attemptsError } = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (attemptsError) return dbError(attemptsError);
  const attempts = (data ?? []).filter((a) => a.status === "submitted");
  const current = currentAttempt(attempts);
  return json({
    assignment,
    student: { enrollment_id: enrollmentId, name: studentName(student) },
    attempts,
    current_submission_id: current?.id ?? null,
  });
}
