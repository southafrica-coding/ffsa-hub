import {
  authorizeStudent,
  badRequest,
  conflict,
  dbError,
  json,
  lateNotAllowed,
  notFound,
  readJson,
} from "@/lib/schools/lms-assignments-auth";
import {
  lateDecision,
  openDraft,
  submitPlan,
  validateSubmissionContent,
} from "@/lib/schools/lms-assignments";
import { loadStudentAssignment } from "@/lib/schools/lms-student-assignment";
import { existingObjects } from "@/lib/schools/lms-storage";
import { insertAttempt, listAttempts, updateDraft } from "@/services/lms-assignments";

// POST …/assignments/[assignmentId]/submit   { body_text?, link_url? }
// Turns the open draft into a submitted attempt, or creates attempt N+1
// when the latest is already submitted or graded. Earlier attempts and
// their grades are untouched. allow_late = false past due_at → 409
// late_not_allowed (the DB trigger refuses it too).

type Ctx = { params: Promise<{ enrollmentId: string; assignmentId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { enrollmentId, assignmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded.response;
  const { assignment } = loaded;

  if (!lateDecision(assignment).allowed) return lateNotAllowed();

  const attempts = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (attempts.error) return dbError(attempts.error);
  const all = attempts.data ?? [];
  const draft = openDraft(all);
  const content = validateSubmissionContent(await readJson(request), assignment.submission_types, {
    submitting: true,
    fileCount: draft?.files.length ?? 0,
  });
  if (!content.ok) return badRequest(content.error);

  // Every registered file must have finished uploading.
  if (draft && draft.files.length > 0) {
    const folder = `${assignment.program_id}/${assignmentId}/${draft.id}`;
    const present = await existingObjects(folder);
    const missing = draft.files.filter((f) => !present.has(f.storage_path));
    if (missing.length > 0) {
      return conflict(
        "upload_incomplete",
        `${missing.map((f) => f.file_name).join(", ")} did not finish uploading. Remove it and try again.`
      );
    }
  }

  const plan = submitPlan(all);
  const result =
    plan.kind === "submit_draft"
      ? await updateDraft(auth.supabase, plan.draftId, content.value, "submitted")
      : await insertAttempt(auth.supabase, assignmentId, enrollmentId, content.value, "submitted");
  if (result.error) return dbError(result.error);
  if (!result.data) return notFound("Draft");
  return json({ attempt: result.data }, 201);
}
