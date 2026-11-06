// Course shells for training admins. Rows are billing_courses.
// Fee items are not written here. Callers pass a client (the route uses the
// service role after userCanManageProgram, because billing_courses INSERT
// RLS is finance-only — migration 098).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// credit_hours (179) and graded (259) can be absent if those migrations
// have not been applied yet. Same fallback the school page uses.
const COLUMN_SETS = [
  "id, program_id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, credit_hours, graded, notes, lead_staff_id, created_at, updated_at",
  "id, program_id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, credit_hours, notes, lead_staff_id, created_at, updated_at",
  "id, program_id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, notes, lead_staff_id, created_at, updated_at",
];

async function readWithFallback(run: (columns: string) => Promise<{ data: unknown; error: { code?: string } | null }>) {
  let last: { data: unknown; error: { code?: string } | null } = { data: null, error: null };
  for (const columns of COLUMN_SETS) {
    last = await run(columns);
    if (!last.error) return last;
    if (last.error.code !== "42703" && last.error.code !== "PGRST204") return last;
  }
  return last;
}

export async function listLearningCourses(supabase: Client, programId: string) {
  return readWithFallback((columns) =>
    supabase
      .from("billing_courses")
      .select(columns)
      .eq("program_id", programId)
      .order("sequence", { ascending: true })
      .order("name", { ascending: true })
  );
}

export async function getLearningCourse(supabase: Client, programId: string, courseId: string) {
  return readWithFallback((columns) =>
    supabase.from("billing_courses").select(columns).eq("program_id", programId).eq("id", courseId).maybeSingle()
  );
}

export async function insertLearningCourse(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("billing_courses").insert(row).select("*").single();
}

export async function updateLearningCourse(
  supabase: Client,
  programId: string,
  courseId: string,
  patch: Record<string, unknown>
) {
  return supabase
    .from("billing_courses")
    .update(patch)
    .eq("program_id", programId)
    .eq("id", courseId)
    .select("*")
    .single();
}

export async function deleteLearningCourse(supabase: Client, programId: string, courseId: string) {
  return supabase.from("billing_courses").delete().eq("program_id", programId).eq("id", courseId);
}

export async function countRelated(supabase: Client, table: string, column: string, id: string) {
  return supabase.from(table).select("id", { count: "exact", head: true }).eq(column, id);
}

export async function postOfficialGrade(
  supabase: Client,
  row: {
    enrollment_id: string;
    course_id: string;
    letter_grade: string;
    notes: string | null;
    graded_by: string;
  }
) {
  return supabase
    .from("grades")
    .upsert({ ...row, graded_at: new Date().toISOString() }, { onConflict: "enrollment_id,course_id" })
    .select("id, enrollment_id, course_id, letter_grade, notes, graded_by, graded_at")
    .single();
}
