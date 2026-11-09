import {
  authorizeAssignments,
  badRequest,
  dbError,
  json,
  notFound,
  readJson,
} from "@/lib/schools/lms-assignments-auth";
import {
  buildGradingRows,
  countStatuses,
  validateAssignmentInput,
} from "@/lib/schools/lms-assignments";
import {
  createAssignment,
  gradingRoster,
  listAssignmentsForProgram,
  listSubmittedAttempts,
  programIdForCourse,
} from "@/services/lms-assignments";

// GET  /api/schools/programs/[programId]/lms/assignments
//      Graders (leaders + program staff). Editors also get drafts. Each
//      assignment carries missing / submitted / late / graded / released counts.
// POST /api/schools/programs/[programId]/lms/assignments   (editors)
//      { course_id, title, instructions?, due_at?, allow_late?, submission_types, max_points, lesson_id? }

type Ctx = { params: Promise<{ programId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;

  const { data: assignments, error } = await listAssignmentsForProgram(auth.supabase, programId, {
    includeUnpublished: auth.canEdit,
  });
  if (error) return dbError(error);
  const list = assignments ?? [];

  const [roster, attempts] = await Promise.all([
    gradingRoster(auth.supabase, programId),
    listSubmittedAttempts(auth.supabase, list.map((a) => a.id)),
  ]);
  if (roster.error) return dbError(roster.error);
  if (attempts.error) return dbError(attempts.error);

  return json({
    canEdit: auth.canEdit,
    assignments: list.map((a) => ({
      ...a,
      counts: countStatuses(
        buildGradingRows(roster.data ?? [], attempts.data ?? [], a.id).map((r) => r.status)
      ),
    })),
  });
}

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorizeAssignments(programId, "edit");
  if ("response" in auth) return auth.response;
  const input = validateAssignmentInput(await readJson(request));
  if (!input.ok) return badRequest(input.error);
  if ((await programIdForCourse(auth.supabase, input.value.course_id)) !== programId) {
    return notFound("Course");
  }
  const { data, error } = await createAssignment(auth.supabase, input.value, auth.userId);
  if (error) return dbError(error);
  return json({ assignment: data }, 201);
}
