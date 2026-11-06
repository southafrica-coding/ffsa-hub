// Proposed tables: course_graders, grade_marks.
// One official transcript letter stays on `grades`. These tables hold the
// extra graders and each person's mark. Hub Data applies them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function listCourseGraders(supabase: Client, programId: string) {
  return supabase
    .from("course_graders")
    .select("id, program_id, billing_course_id, enrollment_id, grader_user_id, can_post_official, assigned_by, created_at")
    .eq("program_id", programId)
    .order("created_at", { ascending: true });
}

export async function insertCourseGrader(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("course_graders").insert(row).select("*").single();
}

export async function deleteCourseGrader(supabase: Client, programId: string, id: string) {
  return supabase.from("course_graders").delete().eq("program_id", programId).eq("id", id).select("id");
}

export async function listGraderRowsForUser(supabase: Client, programId: string, userId: string) {
  return supabase
    .from("course_graders")
    .select("id, billing_course_id, enrollment_id, grader_user_id, can_post_official")
    .eq("program_id", programId)
    .eq("grader_user_id", userId);
}

export async function listGradeMarks(supabase: Client, enrollmentId: string, courseId: string) {
  return supabase
    .from("grade_marks")
    .select("id, enrollment_id, billing_course_id, grader_user_id, letter_grade, notes, updated_at")
    .eq("enrollment_id", enrollmentId)
    .eq("billing_course_id", courseId);
}

export async function upsertGradeMark(
  supabase: Client,
  row: {
    enrollment_id: string;
    billing_course_id: string;
    grader_user_id: string;
    letter_grade: string;
    notes: string | null;
  }
) {
  return supabase
    .from("grade_marks")
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: "enrollment_id,billing_course_id,grader_user_id" }
    )
    .select("id, enrollment_id, billing_course_id, grader_user_id, letter_grade, notes, updated_at")
    .single();
}
