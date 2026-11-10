import { NextResponse } from "next/server";
import { isOpened, openDepartment, serverError } from "@/lib/departments/http";
import { listActiveMembers, loadPeopleById } from "@/lib/departments/repository";
import { personName } from "@/lib/departments/names";

// Active members only. Emails only when canSeePeopleEmails.
// Finance-only viewers get 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  const members = await listActiveMembers(opened.admin, opened.department.id);
  if (members.error) return serverError(members.error);
  const people = await loadPeopleById(opened.admin, members.data.map((member) => member.user_id));
  if (people.error) return serverError(people.error);
  const emails = opened.access.canSeePeopleEmails;
  return NextResponse.json({
    department: { id: opened.department.id, slug: opened.department.slug, name: opened.department.name },
    roster: members.data.map((member) => {
      const person = people.data.get(member.user_id);
      return {
        user_id: member.user_id,
        name: personName(person),
        email: emails ? (person?.email ?? null) : null,
        member_role: member.member_role,
        is_point_leader: member.is_point_leader,
        status: member.status,
      };
    }),
  });
}
