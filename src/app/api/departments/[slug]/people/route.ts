import { NextResponse } from "next/server";
import { canViewDepartment } from "@/lib/departments/access";
import { isDepartmentContext, loadDepartment, notAuthorized, serverError } from "@/lib/departments/http";
import { getDepartmentPeople } from "@/lib/departments/repository";

// GET /api/departments/[slug]/people
// Roster (role, point leader, status) and the ministry's open reporting lines.
// Same view gate as the overview. Unknown slug 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx.response;
  if (!(await canViewDepartment(ctx.supabase, ctx.userId, ctx.department.id))) return notAuthorized();

  const people = await getDepartmentPeople(ctx.admin, ctx.department);
  if (people.error) return serverError(people.error.message);
  return NextResponse.json(people.data);
}
