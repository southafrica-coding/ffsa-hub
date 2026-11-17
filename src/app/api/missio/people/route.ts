import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { createPerson, listPeople, readPeopleQuery } from "@/lib/missio/people";

// GET  /api/missio/people?campus=&status=&q=&limit=&offset=
// POST /api/missio/people
//
// Pastor or Missio org admin only. has_org_role runs before any read and
// before the service-role client exists. org_people reads and PATCH use the
// user client. INSERT is service-role only, and only for a contact id this
// handler just verified or created. Names are read from org_people_directory,
// not from contacts. Campus, status, and stage are stored on org_people.
// The route never writes contact_labels — the org_people trigger applies
// the Missio label.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  const parsed = readPeopleQuery(new URL(request.url));
  if (!parsed.success) return json({ error: "Check the fields and try again." }, 400);

  const result = await listPeople(auth, parsed.data);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result.body);
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again." }, 400);
  }

  const result = await createPerson(auth, body);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result.body, 201);
}
