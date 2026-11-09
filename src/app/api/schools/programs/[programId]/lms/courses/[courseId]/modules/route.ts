import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateModuleInput } from "@/lib/schools/lms-content";
import { createModule, programIdForCourse } from "@/services/lms-content";

// POST …/lms/courses/[courseId]/modules   { title }

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForCourse(auth.supabase, courseId)) !== programId) return notFound("Course");
  const input = validateModuleInput(await readJson(request));
  if (!input.ok) return badRequest(input.error);
  const { data, error } = await createModule(auth.supabase, courseId, input.value);
  if (error) return serverError(error);
  return NextResponse.json({ module: data }, { status: 201 });
}
