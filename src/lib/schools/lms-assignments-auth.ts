import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveProgramViewer } from "@/lib/schools/program-staff-access";
import { isClassroomEnrollment } from "@/lib/schools/lms-content";

// Gates for the slice-2 assignment routes.
//
//   Staff side (/api/schools/programs/[programId]/lms/…):
//     edit  → userCanManageProgram (resolveProgramViewer.canManage)
//     grade → canManage OR program staff of this school
//   Student side (/api/my-schools/[enrollmentId]/lms/assignments/…):
//     the signed-in user's own, still-active enrolment.
//
// Uses the signed-in user's client throughout; RLS in migration 310 repeats
// these rules. No service-role client here.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type GraderAuthOk = {
  supabase: Supabase;
  userId: string;
  canEdit: boolean;
  canGrade: boolean;
};

export async function authorizeAssignments(
  programId: string,
  need: "edit" | "grade"
): Promise<GraderAuthOk | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Not authenticated" }, 401) };
  const viewer = await resolveProgramViewer(supabase, user.id, programId);
  const canEdit = viewer.canManage;
  const canGrade = viewer.canManage || viewer.isStaff;
  if (need === "edit" ? !canEdit : !canGrade) {
    return { response: json({ error: "Not authorized" }, 403) };
  }
  return { supabase, userId: user.id, canEdit, canGrade };
}

export type StudentAuthOk = {
  supabase: Supabase;
  userId: string;
  enrollmentId: string;
  programId: string;
};

export async function authorizeStudent(enrollmentId: string): Promise<StudentAuthOk | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Not authenticated" }, 401) };
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, program_id, user_id, status, removed_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) return { response: json({ error: error.message }, 500) };
  if (!data) return { response: json({ error: "Enrolment not found" }, 404) };
  const row = data as { program_id: string; user_id: string; status: string; removed_at: string | null };
  if (row.user_id !== user.id || !isClassroomEnrollment(row)) {
    return { response: json({ error: "Not authorized" }, 403) };
  }
  return { supabase, userId: user.id, enrollmentId, programId: row.program_id };
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const notFound = (what: string) => json({ error: `${what} not found` }, 404);
export const badRequest = (error: string) => json({ error }, 400);
export const conflict = (error: string, message: string) => json({ error, message }, 409);

export function lateNotAllowed() {
  return conflict("late_not_allowed", "This assignment is past its due date and does not accept late work.");
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

type PgError = { message?: string; code?: string; details?: string | null } | null | undefined;

/**
 * Friendly sentence for a RESTRICT foreign key that is protecting student
 * work (adapted from #501's gradeMarksRestrictMessage). Null when the error
 * is not one of ours.
 */
export function lmsRestrictMessage(error: PgError): string | null {
  if (!error || error.code !== "23503") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (/lms_grades/.test(text)) {
    return "This has graded student work. Unpublish it instead of deleting, so grades are kept.";
  }
  if (/lms_submissions/.test(text)) {
    return "This enrolment has assignment submissions. Remove the student from the school instead of deleting, so their work is kept.";
  }
  return null;
}

const SCHEMA_MISSING = new Set(["42P01", "PGRST205", "PGRST200"]);

/** Map a database error from the user client to a clear HTTP response. */
export function dbError(error: NonNullable<PgError>) {
  const message = error.message ?? "Database error";
  if (/late_not_allowed/.test(message)) return lateNotAllowed();
  const restrict = lmsRestrictMessage(error);
  if (restrict) return conflict("has_student_work", restrict);
  if (error.code && SCHEMA_MISSING.has(error.code) && /lms_/.test(message)) {
    return json({ error: "lms_schema_not_applied", message: "Assignments are not switched on yet." }, 503);
  }
  if (error.code === "23505" && /draft_exists/.test(message)) {
    return conflict("draft_exists", "You already have a draft for this assignment.");
  }
  if (error.code === "42501") return json({ error: "Not authorized" }, 403);
  if (error.code === "23514") {
    if (/frozen|cannot be changed|cannot be removed|cannot be deleted/.test(message)) {
      return conflict("immutable", message);
    }
    return badRequest(message);
  }
  return json({ error: message }, 500);
}
