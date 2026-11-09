import {
  authorizeAssignments,
  badRequest,
  conflict,
  dbError,
  json,
  notFound,
  readJson,
} from "@/lib/schools/lms-assignments-auth";
import { validateAssignmentPatch } from "@/lib/schools/lms-assignments";
import {
  countSubmittedAttempts,
  deleteAssignment,
  getAssignment,
  updateAssignment,
} from "@/services/lms-assignments";

// GET    …/lms/assignments/[assignmentId]   graders
// PATCH  …/lms/assignments/[assignmentId]   editors: fields and published
// DELETE …/lms/assignments/[assignmentId]   editors; refused (409) once
//        any student has submitted — unpublish instead, so work is kept.

type Ctx = { params: Promise<{ programId: string; assignmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, assignmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;
  const { data, error } = await getAssignment(auth.supabase, assignmentId);
  if (error) return dbError(error);
  if (!data || data.program_id !== programId) return notFound("Assignment");
  return json({ assignment: data, canEdit: auth.canEdit });
}

export async function PATCH(request: Request, context: Ctx) {
  const { programId, assignmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "edit");
  if ("response" in auth) return auth.response;
  const existing = await getAssignment(auth.supabase, assignmentId);
  if (existing.error) return dbError(existing.error);
  if (!existing.data || existing.data.program_id !== programId) return notFound("Assignment");
  const patch = validateAssignmentPatch(await readJson(request));
  if (!patch.ok) return badRequest(patch.error);
  const { data, error } = await updateAssignment(auth.supabase, assignmentId, patch.value);
  if (error) return dbError(error);
  if (!data) return notFound("Assignment");
  return json({ assignment: data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, assignmentId } = await context.params;
  const auth = await authorizeAssignments(programId, "edit");
  if ("response" in auth) return auth.response;
  const existing = await getAssignment(auth.supabase, assignmentId);
  if (existing.error) return dbError(existing.error);
  if (!existing.data || existing.data.program_id !== programId) return notFound("Assignment");
  if ((await countSubmittedAttempts(auth.supabase, assignmentId)) > 0) {
    return conflict(
      "has_student_work",
      "Students have submitted work for this assignment. Unpublish it instead of deleting, so their work and grades are kept."
    );
  }
  const { error } = await deleteAssignment(auth.supabase, assignmentId);
  if (error) return dbError(error);
  return json({ ok: true });
}
