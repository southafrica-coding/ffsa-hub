import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { householdForPerson } from "@/lib/missio/households";

// GET /api/missio/people/:id/household   The person's household, or null. Pastors.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET(_request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Person not found.", code: "not_found" }, 404);
  const result = await householdForPerson(auth, id);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ household: result.household });
}
