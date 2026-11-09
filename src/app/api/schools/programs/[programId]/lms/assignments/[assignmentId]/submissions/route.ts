import { authorizeAssignments, dbError, json, notFound } from "@/lib/schools/lms-assignments-auth";
import { buildGradingRows, countStatuses } from "@/lib/schools/lms-assignments";
import { getAssignment, gradingRoster, listSubmittedAttempts } from "@/services/lms-assignments";

// GET …/lms/assignments/[assignmentId]/submissions
// One row per classroom student: missing / submitted / late / graded /
// released, from their current (latest submitted) attempt. Leaders and
// program staff alike. Drafts are never shown.

type Ctx = { params: Promise<{ programId: string; assignmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, assignmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;
  const { data: assignment, error } = await getAssignment(auth.supabase, assignmentId);
  if (error) return dbError(error);
  if (!assignment || assignment.program_id !== programId) return notFound("Assignment");

  const [roster, attempts] = await Promise.all([
    gradingRoster(auth.supabase, programId),
    listSubmittedAttempts(auth.supabase, [assignmentId]),
  ]);
  if (roster.error) return dbError(roster.error);
  if (attempts.error) return dbError(attempts.error);

  const rows = buildGradingRows(roster.data ?? [], attempts.data ?? [], assignmentId);
  return json({
    assignment,
    rows,
    counts: countStatuses(rows.map((r) => r.status)),
    canEdit: auth.canEdit,
  });
}
