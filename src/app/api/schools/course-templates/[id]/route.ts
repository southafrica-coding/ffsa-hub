import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { parseCourseDesign, COURSE_DESIGN_VERSION } from "@/lib/schools/course-design";
import { canManageSchoolGlobally, guardUser, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, json, lmsSchemaNotApplied, previewWritesDisabled } from "@/lib/schools/lms-http";
import { deleteCourseTemplate, getCourseTemplate, updateCourseTemplate } from "@/services/course-designs";

// GET    /api/schools/course-templates/:id
// PATCH  /api/schools/course-templates/:id   { name?, description?, design? }
// DELETE /api/schools/course-templates/:id
//
// A base-wide template (program_id null) is managed only by a global
// schools manager. A school template is managed by that school's leaders.

type Ctx = { params: Promise<{ id: string }> };

async function loadAuthorized(id: string) {
  const guard = await guardUser();
  if (isGuard(guard)) return { response: guard.response };
  const row = await getCourseTemplate(createAdminClient(), id);
  if (row.error) {
    if (isLmsSchemaMissing(row.error)) return { response: lmsSchemaNotApplied("Course templates") };
    return { response: dbError(row.error, "Couldn't load the template.") };
  }
  if (!row.data) return { response: json({ error: "not_found", message: "Template not found." }, 404) };
  const template = row.data as { id: string; program_id: string | null };
  const allowed = template.program_id
    ? await userCanManageProgram(guard.supabase, guard.user.id, template.program_id)
    : await canManageSchoolGlobally(guard.supabase, guard.user.id);
  if (!allowed) return { response: json({ error: "forbidden", message: "You cannot manage this template." }, 403) };
  return { guard, template };
}

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const loaded = await loadAuthorized(id);
  if ("response" in loaded && loaded.response) return loaded.response;
  return json({ template: (loaded as { template: unknown }).template });
}

export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const loaded = await loadAuthorized(id);
  if ("response" in loaded && loaded.response) return loaded.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const guard = (loaded as { guard: { user: { id: string } } }).guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Nothing to update." }, 400);
  }
  const patch: Record<string, unknown> = { updated_by: guard.user.id };
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) {
      return json({ error: "bad_request", message: "Name must be 2–120 characters." }, 400);
    }
    patch.name = name;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : null;
  }
  if ("design" in body) {
    const design = parseCourseDesign(body.design);
    if (!design.ok) return json({ error: "bad_request", message: design.message }, 400);
    patch.design = design.design;
    patch.schema_version = COURSE_DESIGN_VERSION;
  }
  if (Object.keys(patch).length === 1) {
    return json({ error: "bad_request", message: "Nothing to update." }, 400);
  }
  const updated = await updateCourseTemplate(createAdminClient(), id, patch);
  if (updated.error) return dbError(updated.error, "Couldn't update the template.");
  return json({ template: updated.data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const loaded = await loadAuthorized(id);
  if ("response" in loaded && loaded.response) return loaded.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const removed = await deleteCourseTemplate(createAdminClient(), id);
  if (removed.error) return dbError(removed.error, "Couldn't delete the template.");
  return json({ ok: true });
}
