import { NextResponse } from "next/server";
import { serverError } from "@/lib/departments/http";
import { isOpened, openDepartment } from "@/lib/departments/internal/open";
import { loadPeople } from "@/lib/departments/internal/page";

// Active members only, as DepartmentPerson. Emails only when canSeePeopleEmails.
// Finance-only viewers get 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  const people = await loadPeople(opened.admin, opened.department.id, opened.access.canSeePeopleEmails);
  if (people.error) return serverError(people.error);
  return NextResponse.json({ people: people.data });
}
