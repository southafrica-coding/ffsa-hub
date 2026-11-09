import { authorizeStudent, badRequest, dbError, json, notFound, readJson } from "@/lib/schools/lms-assignments-auth";
import { openDraft, validateSubmissionContent } from "@/lib/schools/lms-assignments";
import { loadStudentAssignment } from "@/lib/schools/lms-student-assignment";
import { removeObjects } from "@/lib/schools/lms-storage";
import { deleteDraft, insertAttempt, listAttempts, updateDraft } from "@/services/lms-assignments";

// PUT    …/assignments/[assignmentId]/draft   { body_text?, link_url? }
//        Save (create or update) the one open draft. Not visible to staff.
// DELETE …/assignments/[assignmentId]/draft   Discard the draft and its files.

type Ctx = { params: Promise<{ enrollmentId: string; assignmentId: string }> };

export async function PUT(request: Request, context: Ctx) {
  const { enrollmentId, assignmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded.response;

  const attempts = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (attempts.error) return dbError(attempts.error);
  const draft = openDraft(attempts.data ?? []);
  const content = validateSubmissionContent(await readJson(request), loaded.assignment.submission_types, {
    submitting: false,
    fileCount: draft?.files.length ?? 0,
  });
  if (!content.ok) return badRequest(content.error);

  const result = draft
    ? await updateDraft(auth.supabase, draft.id, content.value, "draft")
    : await insertAttempt(auth.supabase, assignmentId, enrollmentId, content.value, "draft");
  if (result.error) return dbError(result.error);
  if (!result.data) return notFound("Draft");
  return json({ draft: result.data }, draft ? 200 : 201);
}

export async function DELETE(_request: Request, context: Ctx) {
  const { enrollmentId, assignmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded.response;

  const attempts = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (attempts.error) return dbError(attempts.error);
  const draft = openDraft(attempts.data ?? []);
  if (!draft) return notFound("Draft");
  const { error, deleted } = await deleteDraft(auth.supabase, draft.id);
  if (error) return dbError(error);
  if (!deleted) return notFound("Draft");
  // Rows are gone (RLS allowed it); clear their objects.
  await removeObjects(draft.files.map((f) => f.storage_path));
  return json({ ok: true });
}
