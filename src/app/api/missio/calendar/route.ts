import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { listCalendarEvents } from "@/lib/missio/calendar/data";

// GET /api/missio/calendar   Pastors only. The Missio calendar's events.
//                            { available: false } until migration 395 is
//                            applied; public holidays and school terms are
//                            added by the page from code, not stored.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const result = await listCalendarEvents(auth);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ available: result.available, events: result.events });
}
