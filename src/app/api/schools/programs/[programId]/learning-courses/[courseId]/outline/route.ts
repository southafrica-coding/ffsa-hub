import { createAdminClient } from "@/lib/supabase/admin";
import { parseCourseDesign, summarizeDesign, COURSE_DESIGN_VERSION } from "@/lib/schools/course-design";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, json, lmsSchemaNotApplied } from "@/lib/schools/lms-http";
import { getCourseOutline, getCourseTemplate, saveCourseOutline } from "@/services/course-designs";
import { getLearningCourse } from "@/services/learning-courses";

// GET /api/schools/programs/:programId/learning-courses/:courseId/outline
// PUT /api/schools/programs/:programId/learning-courses/:courseId/outline
//   { design }  or  { template_id }
//
// Saves the design onto this course. Copying a template copies the document;
// later edits to the template do not rewrite the course. Table course_outlines
// is proposed — 503 until Hub Data applies it.

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const admin = createAdminClient();
  const course = await getLearningCourse(admin, programId, courseId);
  if (course.error) return dbError(course.error, "Couldn't load the course.");
  if (!course.data) return json({ error: "not_found", message: "Course not found in this school." }, 404);

  const outline = await getCourseOutline(admin, courseId);
  if (outline.error) {
    if (isLmsSchemaMissing(outline.error)) return lmsSchemaNotApplied("Course outlines");
    return dbError(outline.error, "Couldn't load the outline.");
  }
  return json({ outline: outline.data });
}

export async function PUT(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  let body: { design?: unknown; template_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "Send a design or a template_id." }, 400);
  }

  const admin = createAdminClient();
  const course = await getLearningCourse(admin, programId, courseId);
  if (course.error) return dbError(course.error, "Couldn't load the course.");
  if (!course.data) return json({ error: "not_found", message: "Course not found in this school." }, 404);

  let design = body.design;
  let templateId: string | null = null;
  if (typeof body.template_id === "string") {
    const template = await getCourseTemplate(admin, body.template_id);
    if (template.error) {
      if (isLmsSchemaMissing(template.error)) return lmsSchemaNotApplied("Course templates");
      return dbError(template.error, "Couldn't load the template.");
    }
    const row = template.data as { design: unknown; program_id: string | null } | null;
    if (!row) return json({ error: "not_found", message: "Template not found." }, 404);
    if (row.program_id && row.program_id !== programId) {
      return json({ error: "forbidden", message: "That template belongs to another school." }, 403);
    }
    design = row.design;
    templateId = body.template_id;
  }

  const parsed = parseCourseDesign(design);
  if (!parsed.ok) return json({ error: "bad_request", message: parsed.message }, 400);

  const saved = await saveCourseOutline(admin, {
    billing_course_id: courseId,
    template_id: templateId,
    design: parsed.design,
    schema_version: COURSE_DESIGN_VERSION,
    saved_by: guard.user.id,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (isLmsSchemaMissing(saved.error)) return lmsSchemaNotApplied("Course outlines");
    return dbError(saved.error, "Couldn't save the outline.");
  }
  return json({ outline: saved.data, summary: summarizeDesign(parsed.design) });
}
