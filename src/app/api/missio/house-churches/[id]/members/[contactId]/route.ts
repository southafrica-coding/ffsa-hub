import { NextResponse } from "next/server";
import { invalidInput } from "@/lib/missio/db-errors";
import { changeMemberRole, endMember, houseReadAccess, isUuid, publicError } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// PATCH  /api/missio/house-churches/:id/members/:contactId  { role }
// Pastors, and coaches in houses they coach. UPDATE is limited to role and ended_at. This route changes role.
// ended_at is set by DELETE.
// DELETE /api/missio/house-churches/:id/members/:contactId
//
// Pastor check, then the membership. DELETE only sets ended_at to the UTC
// database date. An already-ended row returns membership_not_current.
// org_people is not touched.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; contactId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(request: Request, context: Ctx) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  // Pastors anywhere; coaches only in houses they coach. Leaders read only.
  if (!access.abilities.editMembers) return json({ error: "Not authorized", code: "forbidden" }, 403);

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { id, contactId } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const input = invalidInput();
    return json({ error: input.error, code: input.code, fieldErrors: input.fieldErrors }, input.status);
  }

  const result = await changeMemberRole(access.auth, access.editScope, id, contactId, body);
  if (!result.ok) return json(publicError(result), result.status);
  return json({ member: result.member });
}

export async function DELETE(_request: Request, context: Ctx) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  // Pastors anywhere; coaches only in houses they coach. Leaders read only.
  if (!access.abilities.editMembers) return json({ error: "Not authorized", code: "forbidden" }, 403);

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { id, contactId } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  const result = await endMember(access.auth, access.editScope, id, contactId);
  if (!result.ok) return json(publicError(result), result.status);
  return json({ ok: true });
}
