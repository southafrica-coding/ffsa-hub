import { NextResponse } from "next/server";
import { canViewDepartment } from "@/lib/departments/access";
import { isDepartmentContext, loadDepartment, notAuthorized, serverError } from "@/lib/departments/http";
import { getDepartmentOverview } from "@/lib/departments/repository";

// GET /api/departments/[slug]/overview
// Purpose, leaders and counts for one staff ministry.
// Allowed: unscoped admin / super_admin, an active member of this ministry,
// or a Leadership Team member. Anyone else 403. Unknown slug 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canViewDepartment(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const overview = await getDepartmentOverview(ctx.admin, ctx.department);
  if (overview.error) return serverError(overview.error.message);
  return NextResponse.json(overview.data);
}
