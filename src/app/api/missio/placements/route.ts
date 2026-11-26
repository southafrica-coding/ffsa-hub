import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { houseReadAccess } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";
import { createPlacement, listPlacements } from "@/lib/missio/placements";

// GET  /api/missio/placements   Placements this user may see (pastors: all; coaches/leaders: their houses).
// POST /api/missio/placements   { contactId, houseId }  Pastors only: place someone in a house.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET() {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const result = await listPlacements(access.auth, access.scope, access.abilities.place);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ placements: result.placements, canPlace: access.abilities.place });
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
  const result = await createPlacement(auth, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ placement: result.placement, family: result.family }, 201);
}
