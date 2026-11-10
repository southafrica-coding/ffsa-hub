import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { canEditDepartmentRocks, canViewDepartment } from "@/lib/departments/access";
import {
  badRequest,
  isDepartmentContext,
  loadDepartment,
  notAuthorized,
  readJson,
  serverError,
} from "@/lib/departments/http";
import { createDepartmentRock, listDepartmentRocks } from "@/lib/departments/repository";
import { currentQuarter, parseQuarter } from "@/lib/departments/quarter";
import { parseRockCreate } from "@/lib/departments/validate";

// GET  /api/departments/[slug]/rocks?quarter=2026-Q4
//   This quarter's rocks. View gate (member, Leadership Team, admin).
// POST /api/departments/[slug]/rocks
//   Create a rock. Ministry leaders and admins only. A plain member is 403.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canViewDepartment(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const quarter = parseQuarter(new URL(request.url).searchParams.get("quarter"));
  if (!quarter.ok) return badRequest(quarter.error);

  const [rocks, canEdit] = await Promise.all([
    listDepartmentRocks(ctx.admin, ctx.department, quarter.quarter),
    canEditDepartmentRocks(ctx.supabase, ctx.userId, ctx.department.id),
  ]);
  if (rocks.error) return serverError(rocks.error.message);
  return NextResponse.json({
    department: { id: ctx.department.id, slug: ctx.department.slug, name: ctx.department.name },
    quarter: quarter.quarter,
    can_edit: canEdit,
    rocks: rocks.data,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canEditDepartmentRocks(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseRockCreate(body.value, currentQuarter());
  if (!parsed.ok) return badRequest(parsed.error);

  const created = await createDepartmentRock(ctx.admin, ctx.department, parsed.value, ctx.userId);
  if (created.error) return serverError(created.error.message);
  if (!created.data) return serverError("Rock was not created");

  await createAuditLog(ctx.supabase, {
    action: "department_rock.create",
    resource_type: "rock",
    resource_id: created.data.id,
    changes: { after: parsed.value, staff_ministry_id: ctx.department.id },
  });
  return NextResponse.json({ success: true, rock: created.data });
}
