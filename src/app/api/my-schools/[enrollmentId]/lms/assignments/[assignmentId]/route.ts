import { authorizeStudent, dbError, json } from "@/lib/schools/lms-assignments-auth";
import { currentAttempt, lateDecision, openDraft, releasedOnly } from "@/lib/schools/lms-assignments";
import { loadStudentAssignment } from "@/lib/schools/lms-student-assignment";
import { listAttempts } from "@/services/lms-assignments";

// GET /api/my-schools/[enrollmentId]/lms/assignments/[assignmentId]
// Instructions, the open draft (if any), and every attempt newest first.
// A grade appears only once released.

type Ctx = { params: Promise<{ enrollmentId: string; assignmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { enrollmentId, assignmentId } = await context.params;
  const auth = await authorizeStudent(enrollmentId);
  if ("response" in auth) return auth.response;
  const loaded = await loadStudentAssignment(auth, assignmentId);
  if ("response" in loaded) return loaded.response;

  const { data, error } = await listAttempts(auth.supabase, assignmentId, enrollmentId);
  if (error) return dbError(error);
  const all = (data ?? []).map(releasedOnly);
  const submitted = all.filter((a) => a.status === "submitted");
  const late = lateDecision(loaded.assignment);
  return json({
    assignment: loaded.assignment,
    draft: openDraft(all),
    attempts: submitted,
    current_submission_id: currentAttempt(submitted)?.id ?? null,
    can_submit: late.allowed,
    past_due: late.late,
  });
}
