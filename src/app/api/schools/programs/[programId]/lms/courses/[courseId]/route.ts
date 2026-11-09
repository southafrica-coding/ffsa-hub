import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateCoursePatch } from "@/lib/schools/lms-content";
import { isLmsSchemaMissing, lmsRestrictMessage, lmsRestrictMessageFor } from "@/lib/schools/lms-assignments-auth";
import { countSubmittedAttemptsForCourse } from "@/services/lms-assignments";
import { deleteCourse, getCourseTree, programIdForCourse, updateCourse } from "@/services/lms-content";

// GET    …/lms/courses/[courseId]   course → modules → lessons
// PATCH  …/lms/courses/[courseId]   { title?, description?, published? }
// DELETE …/lms/courses/[courseId]   cascades to modules and lessons;
//        409 while any assignment in it has submitted student work

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const auth = await authorizeLms(programId, "read");
  if ("response" in auth) return auth.response;
  const { data, error } = await getCourseTree(auth.supabase, courseId, {
    includeUnpublished: auth.access.canEdit,
  });
  if (error) return serverError(error);
  if (!data || data.program_id !== programId) return notFound("Course");
  return NextResponse.json({ course: data, canEdit: auth.access.canEdit });
}

export async function PATCH(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForCourse(auth.supabase, courseId)) !== programId) return notFound("Course");
  const patch = validateCoursePatch(await readJson(request));
  if (!patch.ok) return badRequest(patch.error);
  const { data, error } = await updateCourse(auth.supabase, courseId, patch.value);
  if (error) return serverError(error);
  if (!data) return notFound("Course");
  return NextResponse.json({ course: data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForCourse(auth.supabase, courseId)) !== programId) return notFound("Course");

  // Refuse before deleting if any assignment in this course has submitted
  // work (migration 310). Missing lms_submissions (310 not applied yet)
  // means there is nothing to protect.
  const submitted = await countSubmittedAttemptsForCourse(auth.supabase, courseId);
  if (submitted.error && !isLmsSchemaMissing(submitted.error)) return serverError(submitted.error);
  if (submitted.count > 0) {
    return NextResponse.json(
      // The Classroom tab shows data.error, so the sentence goes there.
      { error: lmsRestrictMessageFor("course"), code: "has_student_work" },
      { status: 409 }
    );
  }

  const { error } = await deleteCourse(auth.supabase, courseId);
  if (error) {
    // Backstop: the 310 delete guard / RESTRICT keys raise 23503.
    const restrict = lmsRestrictMessage(error, "course");
    if (restrict) return NextResponse.json({ error: restrict, code: "has_student_work" }, { status: 409 });
    return serverError(error);
  }
  return NextResponse.json({ ok: true });
}
