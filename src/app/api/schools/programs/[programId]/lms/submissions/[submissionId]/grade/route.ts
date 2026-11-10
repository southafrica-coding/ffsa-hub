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
import {
  getAssignment,
  getGradeForSubmission,
  getSubmission,
  submissionIsMine,
  upsertGrade,
} from "@/services/lms-assignments";

// PUT …/lms/submissions/[submissionId]/grade
//     { points, feedback?, release?, expected_updated_at? }
// Grade one specific attempt (points 0..max_points). release: true posts it
// to the student. Leaders and program staff alike. A grade on an attempt
// that has a later submitted attempt is frozen (409).
//
// Optimistic concurrency: send expected_updated_at = the grade's updated_at
// you edited (null if you saw no grade). If someone else has graded or
// re-graded since, nothing is written and the answer is 409 grade_changed.
//
// Nobody grades their own attempt (310 F3). RLS hides the grade row from
// that UPDATE, which looks like "0 rows", so a 0-row result is re-checked:
// 403 not_allowed for your own work (or any other refusal), and 409
// grade_changed only when the grade still exists and its updated_at moved.

type Ctx = { params: Promise<{ programId: string; submissionId: string }> };
type Client = Parameters<typeof getSubmission>[0];

const gradeChanged = () =>
  conflict("grade_changed", "Someone else changed this grade while you were editing. Reload to see it.");
const ownWork = () => json({ error: "not_allowed", message: "You can't grade your own work." }, 403);
const notAllowed = () => json({ error: "not_allowed", message: "You're not allowed to grade this attempt." }, 403);

const sameInstant = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);

/** A refusal: your own work, or not allowed for another reason. */
async function refusal(supabase: Client, submissionId: string) {
  const mine = await submissionIsMine(supabase, submissionId);
  if (mine.error) return dbError(mine.error);
  return mine.data ? ownWork() : notAllowed();
}

/**
 * The UPDATE matched no row. 409 only if the grade is still there and its
 * updated_at is no longer the one we wrote against; otherwise RLS refused.
 */
async function explainNoWrite(supabase: Client, submissionId: string, basedOn: string | null) {
  const mine = await submissionIsMine(supabase, submissionId);
  if (mine.error) return dbError(mine.error);
  if (mine.data) return ownWork();
  const now = await getGradeForSubmission(supabase, submissionId);
  if (now.error) return dbError(now.error);
  // Same PostgREST serialisation both times, so compare exactly (keeps µs).
  if (now.data && now.data.updated_at !== basedOn) return gradeChanged();
  return notAllowed();
}

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
    if (!sameInstant(expected, existing?.updated_at ?? null)) {
      // The grade differs from what the caller edited, unless this is
      // their own attempt, which they may not grade at all.
      const mine = await submissionIsMine(auth.supabase, submissionId);
      if (mine.error) return dbError(mine.error);
      return mine.data ? ownWork() : gradeChanged();
    }
    basedOn = existing ? existing.updated_at : null;
  }

  const result = await upsertGrade(auth.supabase, submissionId, input.value, existing, basedOn);
  if (result.stale) return explainNoWrite(auth.supabase, submissionId, basedOn);
  if (result.error) {
    // A first grade on your own attempt fails the INSERT policy (42501).
    if (result.error.code === "42501") return refusal(auth.supabase, submissionId);
    return dbError(result.error);
  }
  if (!result.data) return notFound("Grade");
  return json({ grade: { ...result.data, points: Number(result.data.points) } });
}
