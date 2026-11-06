import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { parseCourseDesign, summarizeDesign, COURSE_DESIGN_VERSION } from "@/lib/schools/course-design";
import { canManageSchoolGlobally, guardUser, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, isUuid, json, lmsSchemaNotApplied } from "@/lib/schools/lms-http";
import { insertCourseTemplate, listCourseTemplates } from "@/services/course-designs";

// GET  /api/schools/course-templates?program_id=
// POST /api/schools/course-templates
//   { name, description?, program_id: uuid | null, design }
//
// program_id null is a base-wide template (global schools managers only).
// A program id is a template saved for that school.
// Table course_design_templates is proposed — 503 until Hub Data applies it.

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 2 || name.length > 120) return null;
  return name;
}

export async function GET(request: Request) {
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;
  const programId = new URL(request.url).searchParams.get("program_id");
  if (programId && !isUuid(programId)) {
    return json({ error: "bad_request", message: "program_id must be a school id." }, 400);
  }
  if (programId) {
    if (!(await userCanManageProgram(guard.supabase, guard.user.id, programId))) {
      return json({ error: "forbidden", message: "You cannot manage this school." }, 403);
    }
  } else if (!(await canManageSchoolGlobally(guard.supabase, guard.user.id))) {
    return json({ error: "forbidden", message: "Say which school, or ask a schools manager." }, 403);
  }

  const { data, error } = await listCourseTemplates(createAdminClient(), programId);
  if (error) {
    if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied("Course templates");
    return dbError(error, "Couldn't load course templates.");
  }
  return json({
    templates: (data ?? []).map((row: { design: unknown }) => ({
      ...row,
      summary: summarizeIfValid(row.design),
    })),
  });
}

export async function POST(request: Request) {
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Send a template." }, 400);
  }
  const name = readName(body.name);
  if (!name) return json({ error: "bad_request", message: "Name must be 2–120 characters." }, 400);
  const design = parseCourseDesign(body.design);
  if (!design.ok) return json({ error: "bad_request", message: design.message }, 400);

  const programId = body.program_id === null || body.program_id === undefined ? null : String(body.program_id);
  if (programId !== null && !isUuid(programId)) {
    return json({ error: "bad_request", message: "program_id must be a school id or null." }, 400);
  }
  if (programId === null) {
    if (!(await canManageSchoolGlobally(guard.supabase, guard.user.id))) {
      return json({ error: "forbidden", message: "Only a schools manager can save a base-wide template." }, 403);
    }
  } else if (!(await userCanManageProgram(guard.supabase, guard.user.id, programId))) {
    return json({ error: "forbidden", message: "You cannot manage this school." }, 403);
  }

  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : null;
  const { data, error } = await insertCourseTemplate(createAdminClient(), {
    name,
    description,
    program_id: programId,
    design: design.design,
    schema_version: COURSE_DESIGN_VERSION,
    created_by: guard.user.id,
    updated_by: guard.user.id,
  });
  if (error) {
    if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied("Course templates");
    return dbError(error, "Couldn't save the template.");
  }
  return json({ template: data, summary: summarizeDesign(design.design) }, 201);
}

function summarizeIfValid(design: unknown) {
  const parsed = parseCourseDesign(design);
  return parsed.ok ? summarizeDesign(parsed.design) : null;
}
