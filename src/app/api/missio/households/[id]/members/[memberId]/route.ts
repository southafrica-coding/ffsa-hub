import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { removeHouseholdMember } from "@/lib/missio/households";
import { missioRateLimit } from "@/lib/missio/limit";

// DELETE /api/missio/households/:id/members/:memberId   Pastors. The last adult ends the household.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; memberId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await missioRateLimit(auth.user.id, "house-church-write");
  if (limited) return limited;
  const { id, memberId } = await context.params;
  if (!UUID.test(id) || !UUID.test(memberId)) return json({ error: "Not found.", code: "not_found" }, 404);
  const result = await removeHouseholdMember(auth, id, memberId);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ household: result.household });
}
