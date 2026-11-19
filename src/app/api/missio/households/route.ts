import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { createHousehold, listHouseholds } from "@/lib/missio/households";
import { missioRateLimit } from "@/lib/missio/limit";

// GET  /api/missio/households             Every household (People → Households). Pastors.
// POST /api/missio/households { personId } Start a household with this person. Pastors.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET() {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const result = await listHouseholds(auth);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ households: result.households });
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await missioRateLimit(auth.user.id, "house-church-write");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await createHousehold(auth, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ household: result.household }, 201);
}
