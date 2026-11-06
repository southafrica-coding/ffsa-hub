import type { Json } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, json, previewWritesDisabled } from "@/lib/schools/lms-http";
import {
  datesAreOrdered,
  learningCourseDeleteBlock,
  lockedFieldChanges,
  parseLearningCourse,
  transcriptFieldChanges,
} from "@/lib/schools/learning-course";
import {
  countRelated,
  deleteLearningCourse,
  getLearningCourse,
  updateLearningCourse,
} from "@/services/learning-courses";

// PATCH  /api/schools/programs/:programId/learning-courses/:courseId
// DELETE /api/schools/programs/:programId/learning-courses/:courseId
//
// Delete is refused while fee items, billing plans, transcript grades, or
// grader marks still point at the course. countRelated on
// grade_marks.billing_course_id returns 409 before the delete. If that
// check is missed, grade_marks ON DELETE RESTRICT comes back as 23503 and
// dbError maps it to the same 409.

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;

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

  const currentRow = existing.data as Record<string, unknown>;
  const locked = lockedFieldChanges(currentRow, parsed.value);
  if (locked.length > 0) {
    const usage = await usageCounts(admin, courseId);
    if ("response" in usage) return usage.response;
    if (usage.charges > 0 || usage.grades > 0) {
      return json(
        {
          error: "conflict",
          message: "Code, dates, and whether the course is graded cannot change once it has fees or transcript grades.",
        },
        409
      );
    }
  }

  const updated = await updateLearningCourse(admin, programId, courseId, parsed.value);
  if (updated.error) return dbError(updated.error, "Couldn't update the course.");

  const transcript = transcriptFieldChanges(currentRow, parsed.value);
  if (transcript) {
    const { error: auditError } = await admin.from("audit_logs").insert({
      user_id: guard.user.id,
      action: "update",
      resource_type: "billing_courses",
      resource_id: courseId,
      changes: { transcript } as unknown as Json,
    });
    if (auditError) console.error("[lms] transcript audit failed", auditError.code ?? "");
  }

  return json({ course: updated.data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const admin = createAdminClient();
  const existing = await getLearningCourse(admin, programId, courseId);
  if (existing.error) return dbError(existing.error, "Couldn't load the course.");
  if (!existing.data) return json({ error: "not_found", message: "Course not found in this school." }, 404);

  const usage = await usageCounts(admin, courseId);
  if ("response" in usage) return usage.response;
  const block = learningCourseDeleteBlock(usage);
  if (block) return json({ error: "conflict", message: block }, 409);

  const removed = await deleteLearningCourse(admin, programId, courseId);
  if (removed.error) return dbError(removed.error, "Couldn't delete the course.");
  return json({ ok: true });
}

async function usageCounts(
  admin: ReturnType<typeof createAdminClient>,
  courseId: string
): Promise<
  | { response: Response }
  | { charges: number; plans: number; grades: number; marks: number }
> {
  const [charges, plans, grades, marks] = await Promise.all([
    countRelated(admin, "fee_charge_items", "course_id", courseId),
    countRelated(admin, "student_billing_plans", "course_id", courseId),
    countRelated(admin, "grades", "course_id", courseId),
    countRelated(admin, "grade_marks", "billing_course_id", courseId),
  ]);
  for (const result of [charges, plans, grades]) {
    if (result.error) return { response: dbError(result.error, "Couldn't check whether the course is in use.") };
  }
  // grade_marks is proposed. A missing table means there is nothing to wipe.
  // Any other error stops the delete so marks cannot be cascade-removed by surprise.
  if (marks.error) {
    if (!isLmsSchemaMissing(marks.error)) {
      return { response: dbError(marks.error, "Couldn't check grader marks.") };
    }
    return {
      charges: charges.count ?? 0,
      plans: plans.count ?? 0,
      grades: grades.count ?? 0,
      marks: 0,
    };
  }
  return {
    charges: charges.count ?? 0,
    plans: plans.count ?? 0,
    grades: grades.count ?? 0,
    marks: marks.count ?? 0,
  };
}
