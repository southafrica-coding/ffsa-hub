import { authorizeAssignments, dbError, json, notFound } from "@/lib/schools/lms-assignments-auth";
import { getAssignment, getFile, getSubmission } from "@/services/lms-assignments";
import { signDownload } from "@/lib/schools/lms-storage";

// GET …/lms/files/[fileId]   → { url } valid for 5 minutes.
// The file row is read through the grader's own client first (RLS: a
// submitted attempt in a school they grade); only then is a URL signed.

type Ctx = { params: Promise<{ programId: string; fileId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, fileId } = await context.params;
  const auth = await authorizeAssignments(programId, "grade");
  if ("response" in auth) return auth.response;
  const { data: file, error } = await getFile(auth.supabase, fileId);
  if (error) return dbError(error);
  if (!file) return notFound("File");
  const { data: submission } = await getSubmission(auth.supabase, file.submission_id);
  if (!submission) return notFound("File");
  const { data: assignment } = await getAssignment(auth.supabase, submission.assignment_id);
  if (!assignment || assignment.program_id !== programId) return notFound("File");

  const signed = await signDownload(file.storage_path, file.file_name);
  if (!signed.url) return json({ error: signed.error ?? "Could not sign download" }, 502);
  return json({ url: signed.url, expires_in: 300 });
}
