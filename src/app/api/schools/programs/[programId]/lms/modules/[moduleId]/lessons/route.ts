import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateLessonInput } from "@/lib/schools/lms-content";
import { createLesson, programIdForModule } from "@/services/lms-content";

// POST …/lms/modules/[moduleId]/lessons
//      { title, content_type: "rich_text", body } | { title, content_type: "link", link_url }

type Ctx = { params: Promise<{ programId: string; moduleId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { programId, moduleId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForModule(auth.supabase, moduleId)) !== programId) return notFound("Module");
  const input = validateLessonInput(await readJson(request));
  if (!input.ok) return badRequest(input.error);
  const { data, error } = await createLesson(auth.supabase, moduleId, input.value);
  if (error) return serverError(error);
  return NextResponse.json({ lesson: data }, { status: 201 });
}
