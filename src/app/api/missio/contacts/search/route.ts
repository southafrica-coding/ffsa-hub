import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { missioRateLimit } from "@/lib/missio/limit";
import { searchContacts } from "@/lib/missio/people";

// POST /api/missio/contacts/search  { q }
//
// q has to be an email or a phone, sent in the body so it does not land in
// request logs. A name is refused so a pastor cannot walk the FFSA list.
// The exact match uses the service role, and only after has_org_role.
// The body is never logged.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function GET() {
  return json({ error: "Use POST.", code: "method_not_allowed" }, 405);
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;

  const limited = await missioRateLimit(auth.user.id, "contact-search");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const q = body && typeof body === "object" && !Array.isArray(body) && "q" in body ? (body as { q?: unknown }).q : undefined;
  if (typeof q !== "string") {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }

  const result = await searchContacts(auth, q);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ matches: result.matches });
}
