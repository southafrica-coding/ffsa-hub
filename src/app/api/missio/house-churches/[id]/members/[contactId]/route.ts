import { NextResponse } from "next/server";
import { changeMemberRole, endMember, isUuid, pastorHouseAccess } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// PATCH  /api/missio/house-churches/:id/members/:contactId  { role }
// DELETE /api/missio/house-churches/:id/members/:contactId
//
// Delete sets ended_at. It does not remove the row or touch org_people.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; contactId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(request: Request, context: Ctx) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { id, contactId } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }

  const result = await changeMemberRole(access.auth, access.scope, id, contactId, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ member: result.member });
}

export async function DELETE(_request: Request, context: Ctx) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { id, contactId } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  const result = await endMember(access.auth, access.scope, id, contactId);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ ok: true });
}
