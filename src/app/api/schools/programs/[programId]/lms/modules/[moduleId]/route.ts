import { NextResponse } from "next/server";
import { authorizeLms, badRequest, notFound, readJson, serverError } from "@/lib/schools/lms-route-auth";
import { validateModulePatch } from "@/lib/schools/lms-content";
import { deleteModule, programIdForModule, updateModule } from "@/services/lms-content";

// PATCH  …/lms/modules/[moduleId]   { title?, published? }
// DELETE …/lms/modules/[moduleId]   cascades to lessons

type Ctx = { params: Promise<{ programId: string; moduleId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const { programId, moduleId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForModule(auth.supabase, moduleId)) !== programId) return notFound("Module");
  const patch = validateModulePatch(await readJson(request));
  if (!patch.ok) return badRequest(patch.error);
  const { data, error } = await updateModule(auth.supabase, moduleId, patch.value);
  if (error) return serverError(error);
  if (!data) return notFound("Module");
  return NextResponse.json({ module: data });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { programId, moduleId } = await context.params;
  const auth = await authorizeLms(programId, "edit");
  if ("response" in auth) return auth.response;
  if ((await programIdForModule(auth.supabase, moduleId)) !== programId) return notFound("Module");
  const { error } = await deleteModule(auth.supabase, moduleId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
