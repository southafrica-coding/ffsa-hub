import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { searchContacts } from "@/lib/missio/people";

// GET /api/missio/contacts/search?q=
//
// q has to be an email or a phone. A name is refused so a pastor cannot
// walk the FFSA contact list. The exact match uses the service role, and
// only after has_org_role, because pastors cannot read contact_emails or
// contact_phones under RLS. The response is masked either way.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchContacts(auth, q);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ matches: result.matches });
}
