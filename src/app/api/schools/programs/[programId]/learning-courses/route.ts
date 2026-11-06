import { createAdminClient } from "@/lib/supabase/admin";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, json } from "@/lib/schools/lms-http";
import { datesAreOrdered, parseLearningCourse } from "@/lib/schools/learning-course";
import { insertLearningCourse, listLearningCourses } from "@/services/learning-courses";

// GET  /api/schools/programs/:programId/learning-courses
// POST /api/schools/programs/:programId/learning-courses
//
// Training-admin course shell on billing_courses (the table Training
// actually uses — see migration 179). Does not create fee items.
// POST uses the service role because billing_courses write RLS is
// finance-only (migration 098); the permission check above is
// userCanManageProgram.

type Ctx = { params: Promise<{ programId: string }> };

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function GET(_request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const { data, error } = await listLearningCourses(guard.supabase, programId);
  if (error) return dbError(error, "Couldn't load courses.");
  return json({ courses: data ?? [] });
}

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const parsed = parseLearningCourse(await readJson(request), "create");
  if (!parsed.ok) return json({ error: "bad_request", message: parsed.message }, 400);
  const dates = datesAreOrdered(parsed.value as { start_date?: string | null; end_date?: string | null; arrival_date?: string | null });
  if (dates) return json({ error: "bad_request", message: dates }, 400);

  const admin = createAdminClient();
  const { data, error } = await insertLearningCourse(admin, {
    ...parsed.value,
    program_id: programId,
    created_by: guard.user.id,
  });
  if (error) return dbError(error, "Couldn't create the course.");
  return json({ course: data }, 201);
}
