import { NextResponse } from "next/server";
import { authorizeLms, badRequest, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { buildReorderUpdates } from "@/lib/schools/lms-content";
import { applyReorder, siblingIds } from "@/services/lms-content";

// POST /api/schools/programs/[programId]/lms/courses/reorder   { ids: string[] }

type Ctx = { params: Promise<{ programId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  const { ids } = (await readJson(request)) as { ids?: unknown };
  const current = await siblingIds(auth.supabase, "lms_courses", "program_id", programId);
  if (current.error) return serverError(current.error);
  const updates = buildReorderUpdates(current.data ?? [], ids);
  if (!updates.ok) return badRequest(updates.error);
  const { error } = await applyReorder(auth.supabase, "lms_courses", "program_id", programId, updates.value);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
