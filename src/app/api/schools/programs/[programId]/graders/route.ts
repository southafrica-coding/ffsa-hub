import { createAdminClient } from "@/lib/supabase/admin";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, isLmsSchemaMissing, isUuid, json, lmsSchemaNotApplied, previewWritesDisabled } from "@/lib/schools/lms-http";
import { canBeCourseGrader, enrollmentIsClosed } from "@/lib/schools/learning-course";
import { deleteCourseGrader, insertCourseGrader, listCourseGraders } from "@/services/course-graders";
import { getLearningCourse } from "@/services/learning-courses";

// GET    /api/schools/programs/:programId/graders
// POST   /api/schools/programs/:programId/graders
//          { grader_user_id, billing_course_id?, enrollment_id?, can_post_official? }
// DELETE /api/schools/programs/:programId/graders?id=
//
// A grader is scoped to a course, a student, or both. At least one of
// billing_course_id and enrollment_id is required. Null on a column means
// "everyone in the other dimension" once Hub Data's table exists.
// Table course_graders is proposed — 503 until then.

type Ctx = { params: Promise<{ programId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const { data, error } = await listCourseGraders(createAdminClient(), programId);
  if (error) {
    if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied("Course graders");
    return dbError(error, "Couldn't load graders.");
  }
  return json({ graders: data ?? [] });
}

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Send a grader." }, 400);
  }
  const graderId = typeof body.grader_user_id === "string" ? body.grader_user_id : "";
  if (!isUuid(graderId)) return json({ error: "bad_request", message: "grader_user_id is required." }, 400);
  const courseId = body.billing_course_id == null || body.billing_course_id === "" ? null : String(body.billing_course_id);
  const enrollmentId = body.enrollment_id == null || body.enrollment_id === "" ? null : String(body.enrollment_id);
  if (!courseId && !enrollmentId) {
    return json({ error: "bad_request", message: "Scope the grader to a course, a student, or both." }, 400);
  }
  if (courseId && !isUuid(courseId)) return json({ error: "bad_request", message: "billing_course_id is not valid." }, 400);
  if (enrollmentId && !isUuid(enrollmentId)) return json({ error: "bad_request", message: "enrollment_id is not valid." }, 400);

  const admin = createAdminClient();
  const staff = await graderIsStaff(admin, graderId);
  if (staff === "error") return json({ error: "server_error", message: "Couldn't check that person." }, 500);
  if (staff === "no") {
    return json({ error: "bad_request", message: "A grader has to be a staff member, not a student." }, 400);
  }
  if (courseId) {
    const course = await getLearningCourse(admin, programId, courseId);
    if (course.error) return dbError(course.error, "Couldn't load the course.");
    if (!course.data) return json({ error: "bad_request", message: "That course is not in this school." }, 400);
  }
  if (enrollmentId) {
    const { data, error } = await admin
      .from("enrollments")
      .select("id, removed_at, status, program_id")
      .eq("id", enrollmentId)
      .eq("program_id", programId)
      .maybeSingle();
    if (error) return dbError(error, "Couldn't load the enrolment.");
    if (!data) return json({ error: "bad_request", message: "That student is not in this school." }, 400);
    if (enrollmentIsClosed(data)) {
      return json({ error: "bad_request", message: "That student is no longer on this school's roster." }, 400);
    }
  }

  const { data, error } = await insertCourseGrader(admin, {
    program_id: programId,
    billing_course_id: courseId,
    enrollment_id: enrollmentId,
    grader_user_id: graderId,
    can_post_official: body.can_post_official === true,
    assigned_by: guard.user.id,
  });
  if (error) {
    if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied("Course graders");
    return dbError(error, "Couldn't assign the grader.");
  }
  return json({ grader: data }, 201);
}

export async function DELETE(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return json({ error: "bad_request", message: "id is required." }, 400);
  const { data, error } = await deleteCourseGrader(createAdminClient(), programId, id);
  if (error) {
    if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied("Course graders");
    return dbError(error, "Couldn't remove the grader.");
  }
  if (!data || data.length === 0) return json({ error: "not_found", message: "Grader not found in this school." }, 404);
  return json({ ok: true });
}

async function graderIsStaff(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<"yes" | "no" | "error"> {
  const { data, error } = await admin
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId);
  if (error) return "error";
  const names = ((data ?? []) as Array<{ roles: { name: string } | { name: string }[] | null }>).flatMap(
    (row) => {
      if (!row.roles) return [];
      return Array.isArray(row.roles) ? row.roles.map((role) => role.name) : [row.roles.name];
    }
  );
  return canBeCourseGrader(names) ? "yes" : "no";
}
