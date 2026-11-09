import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { buildReorderUpdates } from "@/lib/schools/lms-content";
import { applyReorder, programIdForCourse, siblingIds } from "@/services/lms-content";

// POST …/lms/courses/[courseId]/modules/reorder   { ids: string[] }

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForCourse(auth.supabase, courseId)) !== programId) return notFound("Course");
  const { ids } = (await readJson(request)) as { ids?: unknown };
  const current = await siblingIds(auth.supabase, "lms_modules", "course_id", courseId);
  if (current.error) return serverError(current.error);
  const updates = buildReorderUpdates(current.data ?? [], ids);
  if (!updates.ok) return badRequest(updates.error);
  const { error } = await applyReorder(auth.supabase, "lms_modules", "course_id", courseId, updates.value);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
