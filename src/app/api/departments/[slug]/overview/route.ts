import { NextResponse } from "next/server";
import { isOpened, openDepartment } from "@/lib/departments/http";

// Header only. Finance-only viewers may open it. No detail access is not
// required. Anyone who cannot open the home already 404s in openDepartment.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "any");
  if (!isOpened(opened)) return opened.response;
  return NextResponse.json({
    slug: opened.department.slug,
    name: opened.department.name,
    purpose: opened.department.purpose ?? opened.department.description,
    cluster: opened.department.cluster,
    active: opened.department.is_active,
    access: opened.access,
    budgetOnly: opened.access.canSeeBudget && !opened.access.canSeeDepartmentDetail,
  });
}
