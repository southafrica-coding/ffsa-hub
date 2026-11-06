import { createAdminClient } from "@/lib/supabase/admin";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, json } from "@/lib/schools/lms-http";
import { datesAreOrdered, learningCourseDeleteBlock, parseLearningCourse } from "@/lib/schools/learning-course";
import {
  countRelated,
  deleteLearningCourse,
  getLearningCourse,
  updateLearningCourse,
} from "@/services/learning-courses";

// PATCH  /api/schools/programs/:programId/learning-courses/:courseId
// DELETE /api/schools/programs/:programId/learning-courses/:courseId
//
// Delete is refused while fee items, billing plans, or transcript grades
// still point at the course.

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Nothing to update." }, 400);
  }
  const parsed = parseLearningCourse(body ?? {}, "patch");
  if (!parsed.ok) return json({ error: "bad_request", message: parsed.message }, 400);

  const admin = createAdminClient();
  const existing = await getLearningCourse(admin, programId, courseId);
  if (existing.error) return dbError(existing.error, "Couldn't load the course.");
  if (!existing.data) return json({ error: "not_found", message: "Course not found in this school." }, 404);

  const current = existing.data as {
    start_date: string | null;
    end_date: string | null;
    arrival_date: string | null;
  };
  const dates = datesAreOrdered({
    start_date: ("start_date" in parsed.value ? parsed.value.start_date : current.start_date) as string | null,
    end_date: ("end_date" in parsed.value ? parsed.value.end_date : current.end_date) as string | null,
    arrival_date: ("arrival_date" in parsed.value ? parsed.value.arrival_date : current.arrival_date) as string | null,
  });
  if (dates) return json({ error: "bad_request", message: dates }, 400);

  const updated = await updateLearningCourse(admin, programId, courseId, parsed.value);
  if (updated.error) return dbError(updated.error, "Couldn't update the course.");
  return json({ course: updated.data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const admin = createAdminClient();
  const existing = await getLearningCourse(admin, programId, courseId);
  if (existing.error) return dbError(existing.error, "Couldn't load the course.");
  if (!existing.data) return json({ error: "not_found", message: "Course not found in this school." }, 404);

  const [charges, plans, grades] = await Promise.all([
    countRelated(admin, "fee_charge_items", "course_id", courseId),
    countRelated(admin, "student_billing_plans", "course_id", courseId),
    countRelated(admin, "grades", "course_id", courseId),
  ]);
  for (const result of [charges, plans, grades]) {
    if (result.error) return dbError(result.error, "Couldn't check whether the course is in use.");
  }
  const block = learningCourseDeleteBlock({
    charges: charges.count ?? 0,
    plans: plans.count ?? 0,
    grades: grades.count ?? 0,
  });
  if (block) return json({ error: "conflict", message: block }, 409);

  const removed = await deleteLearningCourse(admin, programId, courseId);
  if (removed.error) return dbError(removed.error, "Couldn't delete the course.");
  return json({ ok: true });
}
