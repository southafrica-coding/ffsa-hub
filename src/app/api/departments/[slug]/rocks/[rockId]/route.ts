import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { badRequest, isOpened, notFound, openDepartment, readJson, serverError } from "@/lib/departments/http";
import { isActiveMinistryMember, updateRock } from "@/lib/departments/repository";
import { isUuid, parseRockPatch } from "@/lib/departments/validate";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; rockId: string }> }
) {
  const { slug, rockId } = await params;
  const opened = await openDepartment(slug, "detail");
  if (!isOpened(opened)) return opened.response;
  if (!opened.access.canEditRocks || !isUuid(rockId)) return notFound("Department not found");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseRockPatch(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  if (parsed.value.owner_user_id) {
    const member = await isActiveMinistryMember(opened.admin, opened.department.id, parsed.value.owner_user_id);
    if (member.error) return serverError(member.error);
    if (!member.data) return badRequest("owner_user_id must be an active member of this ministry");
  }
  const updated = await updateRock(opened.admin, opened.department.id, rockId, parsed.value);
  if (updated.error) return serverError(updated.error);
  if (!updated.data) return notFound("Rock not found");
  await createAuditLog(opened.supabase, {
    action: "department_rock.update",
    resource_type: "rock",
    resource_id: rockId,
    changes: { after: parsed.value },
  });
  return NextResponse.json({ success: true, rock: updated.data });
}
