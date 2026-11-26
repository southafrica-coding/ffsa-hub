import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { createCalendarEvent } from "@/lib/missio/calendar/data";
import { calendarPastorLimit } from "@/lib/missio/calendar/limit";

// POST /api/missio/calendar/events   Pastors only. Add an event; the calendar
//                                    is made on the first one.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await calendarPastorLimit(auth.user.id, "write");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await createCalendarEvent(auth, body);
  if (!result.ok) return json({ error: result.error, code: result.code, fieldErrors: result.fieldErrors }, result.status);
  return json({ event: result.event }, 201);
}
