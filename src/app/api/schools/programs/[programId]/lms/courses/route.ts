import { NextResponse } from "next/server";
import { authorizeLms, badRequest, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateCourseInput } from "@/lib/schools/lms-content";
import { createCourse, listCoursesForProgram } from "@/services/lms-content";

// GET  /api/schools/programs/[programId]/lms/courses
//      Editors get drafts too; staff and enrolled students get published only.
// POST /api/schools/programs/[programId]/lms/courses   { title, description? }

type Ctx = { params: Promise<{ programId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorizeLms(programId, "read");
  if ("response" in auth) return auth.response;
  const { data, error } = await listCoursesForProgram(auth.supabase, programId, {
    includeUnpublished: auth.access.canEdit,
  });
  if (error) return serverError(error);
  return NextResponse.json({ courses: data ?? [], canEdit: auth.access.canEdit });
}

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  const input = validateCourseInput(await readJson(request));
  if (!input.ok) return badRequest(input.error);
  const { data, error } = await createCourse(auth.supabase, programId, input.value, auth.userId);
  if (error) return serverError(error);
  return NextResponse.json({ course: data }, { status: 201 });
}
