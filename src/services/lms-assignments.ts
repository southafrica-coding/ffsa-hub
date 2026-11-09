import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AssignmentInput,
  type AssignmentPatch,
  type AttemptWithDetail,
  type LmsAssignment,
  type LmsGrade,
  type LmsSubmission,
  type LmsSubmissionFile,
  type SubmissionContent,
} from "@/lib/schools/lms-assignments";

// Schools LMS assignments (migration 310). Always called with the signed-in
// user's client: RLS on lms_assignments / lms_submissions /
// lms_submission_files / lms_grades is the second gate behind the route
// checks, and the triggers in 310 own attempt numbering, the late rule and
// grade bounds. Storage signing lives in the routes (service role, only
// after the route has read the file row through this client).

// lms_* tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient | any;
export type DbError = { message: string; code?: string; details?: string | null } | null;
type DbResult<T> = { data: T | null; error: DbError };

export type AssignmentWithProgram = LmsAssignment & { program_id: string; course_title: string; course_published: boolean };

const ASSIGNMENT_SELECT = "*, lms_courses!inner(program_id, title, published)";

function flattenAssignment(row: Record<string, unknown>): AssignmentWithProgram {
  const course = (Array.isArray(row.lms_courses) ? row.lms_courses[0] : row.lms_courses) as
    | { program_id: string; title: string; published: boolean }
    | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lms_courses: _drop, ...rest } = row;
  return {
    ...(rest as unknown as LmsAssignment),
    max_points: Number(rest.max_points),
    program_id: course?.program_id ?? "",
    course_title: course?.title ?? "",
    course_published: course?.published ?? false,
  };
}

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function toAttempt(row: Record<string, unknown>): AttemptWithDetail {
  const grade = one<LmsGrade>(row.lms_grades);
  const files = ((row.lms_submission_files ?? []) as LmsSubmissionFile[])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lms_grades: _g, lms_submission_files: _f, ...rest } = row;
  return {
    ...(rest as unknown as LmsSubmission),
    files,
    grade: grade ? { ...grade, points: Number(grade.points) } : null,
  };
}

const ATTEMPT_SELECT = "*, lms_submission_files(*), lms_grades(*)";

const PAGE = 1000;

/** PostgREST caps a read at 1000 rows; page until a short page comes back. */
async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<DbResult<Record<string, unknown>[]>> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { data: rows, error: null };
}

// ── Assignments ─────────────────────────────────────────────

export async function getAssignment(supabase: Client, assignmentId: string): Promise<DbResult<AssignmentWithProgram>> {
  const { data, error } = await supabase
    .from("lms_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data ? flattenAssignment(data) : null, error: null };
}

/** Editors pass includeUnpublished; staff and students see published assignments in published courses. */
export async function listAssignmentsForProgram(
  supabase: Client,
  programId: string,
  opts: { includeUnpublished: boolean }
): Promise<DbResult<AssignmentWithProgram[]>> {
  let query = supabase
    .from("lms_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("lms_courses.program_id", programId);
  if (!opts.includeUnpublished) {
    query = query.eq("published", true).eq("lms_courses.published", true);
  }
  const { data, error } = await query.order("due_at", { ascending: true, nullsFirst: false });
  if (error) return { data: null, error };
  return { data: ((data ?? []) as Record<string, unknown>[]).map(flattenAssignment), error: null };
}

export async function programIdForCourse(supabase: Client, courseId: string): Promise<string | null> {
  const { data } = await supabase.from("lms_courses").select("program_id").eq("id", courseId).maybeSingle();
  return (data as { program_id: string } | null)?.program_id ?? null;
}

export async function createAssignment(
  supabase: Client,
  input: AssignmentInput & { course_id: string },
  createdBy: string
): Promise<DbResult<LmsAssignment>> {
  return supabase
    .from("lms_assignments")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
}

export async function updateAssignment(
  supabase: Client,
  assignmentId: string,
  patch: AssignmentPatch
): Promise<DbResult<LmsAssignment>> {
  return supabase.from("lms_assignments").update(patch).eq("id", assignmentId).select("*").maybeSingle();
}

export async function deleteAssignment(supabase: Client, assignmentId: string): Promise<{ error: DbError }> {
  const { error } = await supabase.from("lms_assignments").delete().eq("id", assignmentId);
  return { error };
}

/** Submitted attempts under any assignment of a course (editors see these under RLS). */
export async function countSubmittedAttemptsForCourse(supabase: Client, courseId: string): Promise<{ count: number; error: DbError }> {
  const { count, error } = await supabase
    .from("lms_submissions")
    .select("id, lms_assignments!inner(course_id)", { count: "exact", head: true })
    .eq("lms_assignments.course_id", courseId)
    .eq("status", "submitted");
  return { count: count ?? 0, error };
}

/** Submitted attempts on an assignment (graders see these under RLS). */
export async function countSubmittedAttempts(supabase: Client, assignmentId: string): Promise<number> {
  const { count } = await supabase
    .from("lms_submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("status", "submitted");
  return count ?? 0;
}

// ── Grading ─────────────────────────────────────────────────

export type RosterStudent = {
  enrollment_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  status: string;
};

/** Every classroom student in the school (SECURITY DEFINER RPC; empty for non-graders). */
export async function gradingRoster(supabase: Client, programId: string): Promise<DbResult<RosterStudent[]>> {
  const { data, error } = await supabase.rpc("lms_grading_roster", { target_program_id: programId });
  if (error) return { data: null, error };
  return { data: (data ?? []) as RosterStudent[], error: null };
}

/** All submitted attempts (with files and grades) on these assignments. Graders only, under RLS. */
export async function listSubmittedAttempts(
  supabase: Client,
  assignmentIds: string[]
): Promise<DbResult<AttemptWithDetail[]>> {
  if (assignmentIds.length === 0) return { data: [], error: null };
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from("lms_submissions")
      .select(ATTEMPT_SELECT)
      .in("assignment_id", assignmentIds)
      .eq("status", "submitted")
      .order("attempt_no", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) return { data: null, error };
  return { data: (data ?? []).map(toAttempt), error: null };
}

/** Every attempt one student has on one assignment, newest first. */
export async function listAttempts(
  supabase: Client,
  assignmentId: string,
  enrollmentId: string
): Promise<DbResult<AttemptWithDetail[]>> {
  const { data, error } = await supabase
    .from("lms_submissions")
    .select(ATTEMPT_SELECT)
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .order("attempt_no", { ascending: false });
  if (error) return { data: null, error };
  return { data: ((data ?? []) as Record<string, unknown>[]).map(toAttempt), error: null };
}

/** A student's attempts across many assignments (their own rows under RLS). */
export async function listAttemptsForEnrollment(
  supabase: Client,
  enrollmentId: string,
  assignmentIds: string[]
): Promise<DbResult<AttemptWithDetail[]>> {
  if (assignmentIds.length === 0) return { data: [], error: null };
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from("lms_submissions")
      .select(ATTEMPT_SELECT)
      .eq("enrollment_id", enrollmentId)
      .in("assignment_id", assignmentIds)
      .order("attempt_no", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) return { data: null, error };
  return { data: (data ?? []).map(toAttempt), error: null };
}

export async function getSubmission(supabase: Client, submissionId: string): Promise<DbResult<AttemptWithDetail>> {
  const { data, error } = await supabase
    .from("lms_submissions")
    .select(ATTEMPT_SELECT)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data ? toAttempt(data) : null, error: null };
}

/**
 * Insert or update the grade on one attempt. release: true also posts it to
 * the student. An update only lands if the row still has the updated_at the
 * caller based its edit on (`basedOn`); otherwise `stale` is true and nothing
 * changes, so two graders cannot silently overwrite each other.
 */
export async function upsertGrade(
  supabase: Client,
  submissionId: string,
  input: { points: number; feedback: string | null; release: boolean },
  existing: LmsGrade | null,
  basedOn: string | null = existing?.updated_at ?? null
): Promise<DbResult<LmsGrade> & { stale?: boolean }> {
  const releasedAt = input.release ? new Date().toISOString() : existing?.released_at ?? null;
  if (existing) {
    if (!basedOn) return { data: null, error: null, stale: true };
    const { data, error } = await supabase
      .from("lms_grades")
      .update({ points: input.points, feedback: input.feedback, released_at: releasedAt })
      .eq("id", existing.id)
      .eq("updated_at", basedOn)
      .select("*")
      .maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: null, stale: true };
    return { data, error: null };
  }
  return supabase
    .from("lms_grades")
    .insert({ submission_id: submissionId, points: input.points, feedback: input.feedback, released_at: releasedAt })
    .select("*")
    .single();
}

/** Release held grades by id. Already-released grades are left alone. */
export async function releaseGrades(supabase: Client, gradeIds: string[]): Promise<DbResult<LmsGrade[]>> {
  if (gradeIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("lms_grades")
    .update({ released_at: new Date().toISOString() })
    .in("id", gradeIds)
    .is("released_at", null)
    .select("*");
  if (error) return { data: null, error };
  return { data: (data ?? []) as LmsGrade[], error: null };
}

// ── Student writes ──────────────────────────────────────────

export async function insertAttempt(
  supabase: Client,
  assignmentId: string,
  enrollmentId: string,
  content: SubmissionContent,
  status: "draft" | "submitted"
): Promise<DbResult<LmsSubmission>> {
  return supabase
    .from("lms_submissions")
    .insert({ assignment_id: assignmentId, enrollment_id: enrollmentId, ...content, status })
    .select("*")
    .single();
}

export async function updateDraft(
  supabase: Client,
  draftId: string,
  content: SubmissionContent,
  status: "draft" | "submitted"
): Promise<DbResult<LmsSubmission>> {
  return supabase
    .from("lms_submissions")
    .update({ ...content, status })
    .eq("id", draftId)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
}

export async function insertFileRow(
  supabase: Client,
  row: { id: string; submission_id: string; storage_path: string; file_name: string; mime: string; size_bytes: number }
): Promise<DbResult<LmsSubmissionFile>> {
  return supabase.from("lms_submission_files").insert(row).select("*").single();
}

export async function getFile(supabase: Client, fileId: string): Promise<DbResult<LmsSubmissionFile>> {
  return supabase.from("lms_submission_files").select("*").eq("id", fileId).maybeSingle();
}

export async function deleteFileRow(supabase: Client, fileId: string): Promise<{ error: DbError; deleted: boolean }> {
  const { data, error } = await supabase.from("lms_submission_files").delete().eq("id", fileId).select("id");
  return { error, deleted: Array.isArray(data) && data.length > 0 };
}

export async function deleteDraft(supabase: Client, draftId: string): Promise<{ error: DbError; deleted: boolean }> {
  const { data, error } = await supabase
    .from("lms_submissions")
    .delete()
    .eq("id", draftId)
    .eq("status", "draft")
    .select("id");
  return { error, deleted: Array.isArray(data) && data.length > 0 };
}
