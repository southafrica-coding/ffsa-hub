import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { previewWritesDisabled } from "@/lib/schools/lms-http";
import { buildReorderUpdates } from "@/lib/schools/lms-content";
import { applyReorder, programIdForModule, siblingIds } from "@/services/lms-content";

// POST …/lms/modules/[moduleId]/lessons/reorder   { ids: string[] }

type Ctx = { params: Promise<{ programId: string; moduleId: string }> };

export async function POST(request: Request, context: Ctx) {
  const blocked = previewWritesDisabled();
  if (blocked) return blocked;
  const { programId, moduleId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForModule(auth.supabase, moduleId)) !== programId) return notFound("Module");
  const { ids } = (await readJson(request)) as { ids?: unknown };
  const current = await siblingIds(auth.supabase, "lms_lessons", "module_id", moduleId);
  if (current.error) return serverError(current.error);
  const updates = buildReorderUpdates(current.data ?? [], ids);
  if (!updates.ok) return badRequest(updates.error);
  const { error } = await applyReorder(auth.supabase, "lms_lessons", "module_id", moduleId, updates.value);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
