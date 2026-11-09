import { authorizeAssignments, badRequest, dbError, json, notFound, readJson } from "@/lib/schools/lms-assignments-auth";
import { isUuid } from "@/lib/schools/lms-assignments";
import { getAssignment, listSubmittedAttempts, releaseGrades } from "@/services/lms-assignments";

// POST …/lms/assignments/[assignmentId]/release   { submission_id? }
// Release one attempt's grade, or (no body) every held grade on this
// assignment. Leaders and program staff alike.

type Ctx = { params: Promise<{ programId: string; assignmentId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { programId, assignmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;
  const { data: assignment, error } = await getAssignment(auth.supabase, assignmentId);
  if (error) return dbError(error);
  if (!assignment || assignment.program_id !== programId) return notFound("Assignment");

  const body = (await readJson(request)) as { submission_id?: unknown };
  if (body.submission_id !== undefined && !isUuid(body.submission_id)) {
    return badRequest("submission_id must be an attempt id");
  }

  const attempts = await listSubmittedAttempts(auth.supabase, [assignmentId]);
  if (attempts.error) return dbError(attempts.error);
  const held = (attempts.data ?? []).filter(
    (a) => a.grade && !a.grade.released_at && (body.submission_id === undefined || a.id === body.submission_id)
  );
  if (body.submission_id !== undefined && held.length === 0) {
    const target = (attempts.data ?? []).find((a) => a.id === body.submission_id);
    if (!target) return notFound("Submission");
    if (!target.grade) return badRequest("Grade this attempt before releasing it");
    return json({ released: 0 });
  }

  const { data, error: releaseError } = await releaseGrades(
    auth.supabase,
    held.map((a) => a.grade!.id)
  );
  if (releaseError) return dbError(releaseError);
  return json({ released: data?.length ?? 0 });
}
