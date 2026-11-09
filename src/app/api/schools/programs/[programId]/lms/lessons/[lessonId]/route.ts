import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateLessonPatch } from "@/lib/schools/lms-content";
import { deleteLesson, programIdForLesson, updateLesson } from "@/services/lms-content";

// PATCH  …/lms/lessons/[lessonId]   { title?, published?, content_type + body|link_url? }
// DELETE …/lms/lessons/[lessonId]

type Ctx = { params: Promise<{ programId: string; lessonId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const { programId, lessonId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForLesson(auth.supabase, lessonId)) !== programId) return notFound("Lesson");
  const patch = validateLessonPatch(await readJson(request));
  if (!patch.ok) return badRequest(patch.error);
  const { data, error } = await updateLesson(auth.supabase, lessonId, patch.value);
  if (error) return serverError(error);
  if (!data) return notFound("Lesson");
  return NextResponse.json({ lesson: data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, lessonId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForLesson(auth.supabase, lessonId)) !== programId) return notFound("Lesson");
  const { error } = await deleteLesson(auth.supabase, lessonId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
