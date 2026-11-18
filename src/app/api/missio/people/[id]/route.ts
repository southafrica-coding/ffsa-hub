import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { updatePerson } from "@/lib/missio/people";
import { getPersonProfile } from "@/lib/missio/profile";

// PATCH /api/missio/people/[id]  { campus?, status?, joinedAt?, currentStage? }
//
// Pastors only. The update runs on the user
// client and may change only campus, status, joined_at, and current_stage.
// contact_id and org_id are refused. A row the caller cannot see is a 404.
// There is no delete: set status to inactive.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/missio/people/[id]
//
// Pastors only. The person, the houses they belong to, masked contact
// details and their journey, derived from rows that already exist.
export async function GET(_request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Person not found.", code: "not_found" }, 404);
  const result = await getPersonProfile(auth, id);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.profile);
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json({ error: "Person not found.", code: "not_found" }, 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }

  const result = await updatePerson(auth, id, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ person: result.person });
}
