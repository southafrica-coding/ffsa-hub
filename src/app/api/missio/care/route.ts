import { NextResponse } from "next/server";
import { MISSIO_HOUSE_ROLES, MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { listCare, logCare } from "@/lib/missio/care";
import { missioRateLimit } from "@/lib/missio/limit";

// GET  /api/missio/care   The care board: only the rows RLS lets the caller read (migration 354).
//                         Pastors, coaches and house leaders (who opens Missio). Pastors pull in
//                         connect-card and feedback prayer first.
// POST /api/missio/care   { name?, phone?, needs, body, privacy, urgent } Log a need by hand. Pastors only.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET() {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_HOUSE_ROLES);
  if ("response" in auth) return auth.response;
  const result = await listCare(auth);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ requests: result.requests, me: result.me, pastor: result.pastor });
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
  const result = await logCare(auth, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ ok: true }, 201);
}
