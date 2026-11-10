import { notFound, dbError } from "@/lib/schools/lms-assignments-auth";
import { getAssignment, type AssignmentWithProgram } from "@/services/lms-assignments";
import type { StudentAuthOk } from "@/lib/schools/lms-assignments-auth";

// Loads an assignment for the student routes. 404 unless it belongs to the
// enrolment's school and both it and its course are published (RLS returns
// nothing otherwise anyway; this keeps the API answer the same).
export async function loadStudentAssignment(
  auth: StudentAuthOk,
  assignmentId: string
): Promise<{ assignment: AssignmentWithProgram } | { response: Response }> {
  const { data, error } = await getAssignment(auth.supabase, assignmentId);
  if (error) return { response: dbError(error) };
  if (!data || data.program_id !== auth.programId || !data.published || !data.course_published) {
    return { response: notFound("Assignment") };
  }
  return { assignment: data };
}
