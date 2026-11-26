import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { reviewSuggestion } from "@/lib/missio/household-suggestions";
import { missioRateLimit } from "@/lib/missio/limit";

// POST /api/missio/household-suggestions/:id { action: "accept" | "dismiss", addToExisting? }
// Pastors. Accept links the pair through the household helpers; it never
// moves anyone out of a household or adds children. When one of them already
// has a household, the first accept answers 409 household_exists and the
// pastor confirms with addToExisting: true.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function POST(request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Suggestion not found.", code: "not_found" }, 404);
  const limited = await missioRateLimit(auth.user.id, "house-church-write");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await reviewSuggestion(auth, id, body);
  if (!result.ok) {
    return json({ error: result.error, code: result.code, ...(result.existing ? { existing: result.existing } : {}) }, result.status);
  }
  return json({ status: result.status, household: result.household });
}
