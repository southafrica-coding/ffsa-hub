import { NextResponse } from "next/server";
import { canViewDepartment } from "@/lib/departments/access";
import { isDepartmentContext, loadDepartment, notAuthorized, serverError } from "@/lib/departments/http";
import { getDepartmentOkrs } from "@/lib/departments/repository";

// GET /api/departments/[slug]/okrs
// The current OKR cycle's ministry-scoped objectives and key results.
// Individual objectives stay off this payload. Same view gate as the overview.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canViewDepartment(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const okrs = await getDepartmentOkrs(ctx.admin, ctx.department);
  if (okrs.error) return serverError(okrs.error.message);
  return NextResponse.json(okrs.data);
}
