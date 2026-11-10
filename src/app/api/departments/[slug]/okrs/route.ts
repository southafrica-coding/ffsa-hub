import { NextResponse } from "next/server";
import { isOpened, openDepartment, serverError } from "@/lib/departments/http";
import { loadOkrs } from "@/lib/departments/internal/page";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  const okrs = await loadOkrs(opened.admin, opened.department);
  if (okrs.error) return serverError(okrs.error);
  return NextResponse.json(okrs.data);
}
