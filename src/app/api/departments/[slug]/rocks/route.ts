import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { badRequest, isOpened, notFound, openDepartment, readJson, serverError } from "@/lib/departments/http";
import { personName } from "@/lib/departments/names";
import { currentQuarter, parseQuarter } from "@/lib/departments/quarter";
import { createRock, isActiveMinistryMember, listRocks, loadPeopleById } from "@/lib/departments/repository";
import { parseRockCreate } from "@/lib/departments/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  const quarter = parseQuarter(new URL(request.url).searchParams.get("quarter"));
  if (!quarter.ok) return badRequest(quarter.error);
  const rocks = await listRocks(opened.admin, opened.department.id, quarter.quarter);
  if (rocks.error) return serverError(rocks.error);
  const people = await loadPeopleById(opened.admin, rocks.data.flatMap((rock) => (rock.owner_user_id ? [rock.owner_user_id] : [])));
  if (people.error) return serverError(people.error);
  return NextResponse.json({
    quarter: quarter.quarter,
    can_edit: opened.access.canEditRocks,
    rocks: rocks.data.map((rock) => ({
      ...rock,
      owner_name: rock.owner_user_id ? personName(people.data.get(rock.owner_user_id)) : null,
      dueOn: rock.due_on,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  if (!opened.access.canEditRocks) return notFound("Department not found");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseRockCreate(body.value, currentQuarter());
  if (!parsed.ok) return badRequest(parsed.error);
  if (parsed.value.owner_user_id) {
    const member = await isActiveMinistryMember(opened.admin, opened.department.id, parsed.value.owner_user_id);
    if (member.error) return serverError(member.error);
    if (!member.data) return badRequest("owner_user_id must be an active member of this ministry");
  }
  const created = await createRock(opened.admin, opened.department.id, parsed.value, opened.userId);
  if (created.error) return serverError(created.error);
  if (!created.data) return serverError("Rock was not created");
  await createAuditLog(opened.supabase, {
    action: "department_rock.create",
    resource_type: "rock",
    resource_id: created.data.id,
    changes: { after: parsed.value },
  });
  return NextResponse.json({ success: true, rock: created.data });
}
