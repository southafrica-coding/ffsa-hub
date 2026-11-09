import { randomUUID } from "node:crypto";
import { authorizeStudent, badRequest, dbError, json, readJson } from "@/lib/schools/lms-assignments-auth";
import { buildSubmissionPath, openDraft, validateUploadRequest } from "@/lib/schools/lms-assignments";
import { loadStudentAssignment } from "@/lib/schools/lms-student-assignment";
import { signUpload } from "@/lib/schools/lms-storage";
import { insertAttempt, insertFileRow, listAttempts } from "@/services/lms-assignments";

// POST …/assignments/[assignmentId]/files   { file_name, mime, size_bytes }
// Registers a file on the open draft (creating the draft if needed) and
// returns a signed upload URL. Size (≤20 MB), type (allowlist) and count
// (≤10) are checked here, in the DB, and by the bucket. The path is
// {program}/{assignment}/{submission}/{random uuid}.{ext} — no user ids.

type Ctx = { params: Promise<{ enrollmentId: string; assignmentId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { enrollmentId, assignmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded.response;
  const { assignment } = loaded;
  if (!assignment.submission_types.includes("file")) {
    return badRequest("This assignment does not take files");
  }

  const attempts = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (attempts.error) return dbError(attempts.error);
  let draft = openDraft(attempts.data ?? []);

  const upload = validateUploadRequest(await readJson(request), draft?.files.length ?? 0);
  if (!upload.ok) return badRequest(upload.error);

  let draftId = draft?.id;
  if (!draftId) {
    const created = await insertAttempt(
      auth.supabase,
      assignmentId,
      enrollmentId,
      { body_text: null, link_url: null },
      "draft"
    );
    if (created.error) return dbError(created.error);
    draftId = created.data!.id;
    draft = null;
  }

  const fileId = randomUUID();
  const path = buildSubmissionPath({
    programId: assignment.program_id,
    assignmentId,
    submissionId: draftId,
    objectId: randomUUID(),
    ext: upload.value.ext,
  });
  const row = await insertFileRow(auth.supabase, {
    id: fileId,
    submission_id: draftId,
    storage_path: path,
    file_name: upload.value.file_name,
    mime: upload.value.mime,
    size_bytes: upload.value.size_bytes,
  });
  if (row.error) return dbError(row.error);

  // The row exists under the student's own RLS; only now sign the upload.
  const signed = await signUpload(path);
  if (!signed.data) return json({ error: signed.error ?? "Could not start upload" }, 502);
  return json(
    {
      file: row.data,
      draft_id: draftId,
      upload: { signed_url: signed.data.signedUrl, token: signed.data.token, path },
    },
    201
  );
}
