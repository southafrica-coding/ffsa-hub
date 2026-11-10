import { NextResponse } from "next/server";
import { isOpened, openDepartment, serverError } from "@/lib/departments/http";
import { countActiveMembers } from "@/lib/departments/repository";

// Header only. Finance-only viewers may open it. No detail access is not
// required. Anyone who cannot open the home already 404s in openDepartment.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "any");
  if (!isOpened(opened)) return opened.response;
  const detail = opened.access.canSeeDepartmentDetail;
  let memberCount: number | null = null;
  if (detail) {
    const counts = await countActiveMembers(opened.admin);
    if (counts.error) return serverError(counts.error);
    memberCount = counts.data.get(opened.department.id) ?? 0;
  }
  return NextResponse.json({
    slug: opened.department.slug,
    name: opened.department.name,
    purpose: opened.department.purpose ?? opened.department.description,
    cluster: opened.department.cluster,
    active: opened.department.is_active,
    memberCount,
    access: opened.access,
    budgetOnly: opened.access.canSeeBudget && !detail,
  });
}
