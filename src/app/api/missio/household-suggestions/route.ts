import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { listSuggestions } from "@/lib/missio/household-suggestions";

// GET /api/missio/household-suggestions              Pending couple suggestions. Pastors.
// GET /api/missio/household-suggestions?personId=…   Only that person's.
// First names and person ids only: no emails or phones. Empty until migration 398 is applied.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const personId = new URL(request.url).searchParams.get("personId");
  if (personId !== null && !UUID.test(personId)) return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  const result = await listSuggestions(auth, personId ? { personId } : {});
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ suggestions: result.suggestions });
}
