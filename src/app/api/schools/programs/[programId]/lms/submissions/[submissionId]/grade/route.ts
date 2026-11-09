import { authorizeAssignments, badRequest, dbError, json, notFound, readJson } from "@/lib/schools/lms-assignments-auth";
import { validateGradeInput } from "@/lib/schools/lms-assignments";
import { getAssignment, getSubmission, upsertGrade } from "@/services/lms-assignments";

// PUT …/lms/submissions/[submissionId]/grade   { points, feedback?, release? }
// Grade one specific attempt (points 0..max_points). release: true posts it
// to the student. Leaders and program staff alike. A grade on an attempt
// that has a later submitted attempt is frozen (409).

type Ctx = { params: Promise<{ programId: string; submissionId: string }> };

export async function PUT(request: Request, context: Ctx) {
  const { programId, submissionId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;

  const { data: submission, error } = await getSubmission(auth.supabase, submissionId);
  if (error) return dbError(error);
  if (!submission || submission.status !== "submitted") return notFound("Submission");
  const { data: assignment, error: aError } = await getAssignment(auth.supabase, submission.assignment_id);
  if (aError) return dbError(aError);
  if (!assignment || assignment.program_id !== programId) return notFound("Submission");

  const input = validateGradeInput(await readJson(request), assignment.max_points);
  if (!input.ok) return badRequest(input.error);

  const { data, error: gradeError } = await upsertGrade(auth.supabase, submissionId, input.value, submission.grade);
  if (gradeError) return dbError(gradeError);
  if (!data) return notFound("Grade");
  return json({ grade: { ...data, points: Number(data.points) } });
}
