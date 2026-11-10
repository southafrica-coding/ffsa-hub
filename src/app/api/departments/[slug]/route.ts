import { NextResponse } from "next/server";
import { isOpened, notFound, openDepartment, serverError } from "@/lib/departments/http";
import { buildDepartmentHome } from "@/lib/departments/page";

// GET /api/departments/[slug]
// Detail viewers get the full home. Finance-only viewers get the header
// and the budget; the other sections are null and are not read.
// No detail and no budget access is 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "any");
  if (!isOpened(opened)) return opened.response;
  const home = await buildDepartmentHome(opened.admin, opened.gate, opened.department);
  if (home.error) return serverError(home.error);
  if (!home.data) return notFound("Department not found");
  return NextResponse.json(home.data);
}
