// Proposed tables: course_design_templates, course_outlines.
// Hub Data applies them. Until then these queries fail and the routes
// answer 503 lms_schema_not_applied.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function listCourseTemplates(supabase: Client, programId: string | null) {
  let query = supabase
    .from("course_design_templates")
    .select("id, program_id, name, description, design, schema_version, created_by, updated_by, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (programId) query = query.or(`program_id.eq.${programId},program_id.is.null`);
  return query;
}

export async function getCourseTemplate(supabase: Client, id: string) {
  return supabase.from("course_design_templates").select("*").eq("id", id).maybeSingle();
}

export async function insertCourseTemplate(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("course_design_templates").insert(row).select("*").single();
}

export async function updateCourseTemplate(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("course_design_templates").update(patch).eq("id", id).select("*").single();
}

export async function deleteCourseTemplate(supabase: Client, id: string) {
  return supabase.from("course_design_templates").delete().eq("id", id);
}

export async function getCourseOutline(supabase: Client, courseId: string) {
  return supabase.from("course_outlines").select("*").eq("billing_course_id", courseId).maybeSingle();
}

export async function saveCourseOutline(supabase: Client, row: Record<string, unknown>) {
  return supabase
    .from("course_outlines")
    .upsert(row, { onConflict: "billing_course_id" })
    .select("*")
    .single();
}
