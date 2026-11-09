import {
  authorizeAssignments,
  badRequest,
  conflict,
  dbError,
  json,
  notFound,
  previewWritesDisabled,
  readJson,
} from "@/lib/schools/lms-assignments-auth";
import { validateGradeInput } from "@/lib/schools/lms-assignments";
import { getAssignment, getSubmission, upsertGrade } from "@/services/lms-assignments";

// PUT …/lms/submissions/[submissionId]/grade
//     { points, feedback?, release?, expected_updated_at? }
// Grade one specific attempt (points 0..max_points). release: true posts it
// to the student. Leaders and program staff alike. A grade on an attempt
// that has a later submitted attempt is frozen (409).
//
// Optimistic concurrency: send expected_updated_at = the grade's updated_at
// you edited (null if you saw no grade). If someone else has graded or
// re-graded since, nothing is written and the answer is 409 grade_changed.

type Ctx = { params: Promise<{ programId: string; submissionId: string }> };

const gradeChanged = () =>
  conflict("grade_changed", "Someone else changed this grade while you were editing. Reload to see it.");

export async function PUT(request: Request, context: Ctx) {
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const { programId, submissionId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;

  const { data: submission, error } = await getSubmission(auth.supabase, submissionId);
  if (error) return dbError(error);
  if (!submission || submission.status !== "submitted") return notFound("Submission");
  const { data: assignment, error: aError } = await getAssignment(auth.supabase, submission.assignment_id);
  if (aError) return dbError(aError);
  if (!assignment || assignment.program_id !== programId) return notFound("Submission");

  const body = (await readJson(request)) as Record<string, unknown>;
  const input = validateGradeInput(body, assignment.max_points);
  if (!input.ok) return badRequest(input.error);

  const existing = submission.grade;
  let basedOn: string | null = existing?.updated_at ?? null;
  if ("expected_updated_at" in body) {
    const expected = body.expected_updated_at;
    if (expected !== null && typeof expected !== "string") {
      return badRequest("expected_updated_at must be a timestamp or null");
    }
    const sameMoment =
      expected === null ? existing === null : !!existing && Date.parse(expected) === Date.parse(existing.updated_at);
    if (!sameMoment) return gradeChanged();
    basedOn = existing ? existing.updated_at : null;
  }

  const result = await upsertGrade(auth.supabase, submissionId, input.value, existing, basedOn);
  if (result.stale) return gradeChanged();
  if (result.error) return dbError(result.error);
  if (!result.data) return notFound("Grade");
  return json({ grade: { ...result.data, points: Number(result.data.points) } });
}
