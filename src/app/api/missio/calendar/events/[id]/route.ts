import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/missio/calendar/data";
import { calendarPastorLimit } from "@/lib/missio/calendar/limit";

// PATCH  /api/missio/calendar/events/:id   Pastors only. Replace the event (the
//                                         whole series for a repeating one;
//                                         skipping one date is skipDates).
// DELETE /api/missio/calendar/events/:id   Pastors only. Remove it (every date).

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await calendarPastorLimit(auth.user.id, "write");
  if (limited) return limited;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await updateCalendarEvent(auth, id, body);
  if (!result.ok) return json({ error: result.error, code: result.code, fieldErrors: result.fieldErrors }, result.status);
  return json({ event: result.event });
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await calendarPastorLimit(auth.user.id, "write");
  if (limited) return limited;
  const { id } = await context.params;
  const result = await deleteCalendarEvent(auth, id);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ ok: true });
}
