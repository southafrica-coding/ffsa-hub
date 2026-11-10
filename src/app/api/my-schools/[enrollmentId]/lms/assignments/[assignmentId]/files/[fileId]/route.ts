import { authorizeStudent, dbError, json, notFound, previewWritesDisabled } from "@/lib/schools/lms-assignments-auth";
import { loadStudentAssignment } from "@/lib/schools/lms-student-assignment";
import { removeObjects, signDownload } from "@/lib/schools/lms-storage";
import { deleteFileRow, getFile, getSubmission } from "@/services/lms-assignments";

// GET    …/files/[fileId]   → { url } for the student's own file, 5 minutes.
// DELETE …/files/[fileId]   remove a file from the open draft.

type Ctx = { params: Promise<{ enrollmentId: string; assignmentId: string; fileId: string }> };

async function ownFile(enrollmentId: string, assignmentId: string, fileId: string) {
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded;
  // Both reads go through the student's client: RLS returns only their own.
  const { data: file, error } = await getFile(auth.supabase, fileId);
  if (error) return { response: dbError(error) };
  if (!file) return { response: notFound("File") };
  const { data: submission } = await getSubmission(auth.supabase, file.submission_id);
  if (!submission || submission.enrollment_id !== enrollmentId || submission.assignment_id !== assignmentId) {
    return { response: notFound("File") };
  }
  return { auth, file, submission };
}

export async function GET(_request: Request, context: Ctx) {
  const { enrollmentId, assignmentId, fileId } = await context.params;
  const own = await ownFile(enrollmentId, assignmentId, fileId);
  if ("response" in own) return own.response;
  const signed = await signDownload(own.file);
  if (!signed.url) return json({ error: signed.error ?? "Could not sign download" }, 502);
  return json({ url: signed.url, expires_in: 300 });
}

export async function DELETE(_request: Request, context: Ctx) {
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const { enrollmentId, assignmentId, fileId } = await context.params;
  const own = await ownFile(enrollmentId, assignmentId, fileId);
  if ("response" in own) return own.response;
  if (own.submission.status !== "draft") {
    return json({ error: "immutable", message: "Files on a submitted attempt cannot be removed." }, 409);
  }
  const { error, deleted } = await deleteFileRow(own.auth.supabase, fileId);
  if (error) return dbError(error);
  if (!deleted) return notFound("File");
  await removeObjects([own.file.storage_path]);
  return json({ ok: true });
}
