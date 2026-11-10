import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { canEditDepartmentBudget, canReadDepartmentBudget } from "@/lib/departments/access";
import {
  badRequest,
  isDepartmentContext,
  loadDepartment,
  notAuthorized,
  notFound,
  readJson,
  serverError,
} from "@/lib/departments/http";
import { getDepartmentBudget, updateDepartmentBudget } from "@/lib/departments/repository";
import { parseBudgetPatch } from "@/lib/departments/validate";

// GET   /api/departments/[slug]/budget
//   Linked finance projects, budget and spend.
//   Allowed: unscoped admin, an active leader of this ministry, or any
//   active Finances & Legal member (every department). Everyone else 403.
// PATCH /api/departments/[slug]/budget
//   Edit budget_cents or notes on one link. Leaders of this ministry and
//   admins only. A Finances & Legal member who does not lead it is 403.
//   spend_cents is rejected.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;

  const [allowed, canEdit] = await Promise.all([
    canReadDepartmentBudget(ctx.supabase, ctx.userId, ctx.department.id),
    canEditDepartmentBudget(ctx.supabase, ctx.userId, ctx.department.id),
  ]);
  if (!allowed) return notAuthorized();

  const budget = await getDepartmentBudget(ctx.admin, ctx.department);
  if (budget.error) return serverError(budget.error.message);
  return NextResponse.json({
    department: { id: ctx.department.id, slug: ctx.department.slug, name: ctx.department.name },
    can_edit: canEdit,
    links: budget.data,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canEditDepartmentBudget(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseBudgetPatch(body.value);
  if (!parsed.ok) return badRequest(parsed.error);

  const updated = await updateDepartmentBudget(
    ctx.admin,
    ctx.department.id,
    parsed.value.linkId,
    parsed.value.patch,
    ctx.userId
  );
  if (updated.error) return serverError(updated.error.message);
  if (!updated.data) return notFound("Budget link not found");

  await createAuditLog(ctx.supabase, {
    action: "department_budget.update",
    resource_type: "department_budget_link",
    resource_id: parsed.value.linkId,
    changes: { after: parsed.value.patch, staff_ministry_id: ctx.department.id },
  });
  return NextResponse.json({ success: true, link: updated.data });
}
