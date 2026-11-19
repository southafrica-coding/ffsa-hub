import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { updateHousehold } from "@/lib/missio/households";
import { missioRateLimit } from "@/lib/missio/limit";

// PATCH /api/missio/households/:id { name?, mainContactId? }  Pastors.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await missioRateLimit(auth.user.id, "house-church-write");
  if (limited) return limited;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Household not found.", code: "not_found" }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await updateHousehold(auth, id, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ household: result.household });
}
