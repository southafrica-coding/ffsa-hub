import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { canEditDepartmentRocks } from "@/lib/departments/access";
import {
  badRequest,
  isDepartmentContext,
  loadDepartment,
  notAuthorized,
  notFound,
  readJson,
  serverError,
} from "@/lib/departments/http";
import { updateDepartmentRock } from "@/lib/departments/repository";
import { isUuid, parseRockPatch } from "@/lib/departments/validate";

// PATCH /api/departments/[slug]/rocks/[rockId]
// Update one of this ministry's rocks. Leaders and admins only.
// A rock that is not in this ministry is 404, same as an unknown id.

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; rockId: string }> }
) {
  const { slug, rockId } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canEditDepartmentRocks(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();
  if (!isUuid(rockId)) return notFound("Rock not found");

  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseRockPatch(body.value);
  if (!parsed.ok) return badRequest(parsed.error);

  const updated = await updateDepartmentRock(ctx.admin, ctx.department.id, rockId, parsed.value);
  if (updated.error) return serverError(updated.error.message);
  if (!updated.data) return notFound("Rock not found");

  await createAuditLog(ctx.supabase, {
    action: "department_rock.update",
    resource_type: "rock",
    resource_id: rockId,
    changes: { after: parsed.value, staff_ministry_id: ctx.department.id },
  });
  return NextResponse.json({ success: true, rock: updated.data });
}
