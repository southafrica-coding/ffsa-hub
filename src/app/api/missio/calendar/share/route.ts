import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { appOrigin } from "@/lib/missio/availability/http";
import { calendarShare } from "@/lib/missio/calendar/data";
import { calendarPastorLimit } from "@/lib/missio/calendar/limit";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/missio/calendar/share  { reset?: boolean }  Pastors only.
// The calendar's share link: made the first time, the same one after that,
// a new one on reset (the old link stops at once). The service role touches
// missio_calendar_links only after the pastor check above. The token is in
// the response for the pastor and is never logged.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  const limited = await calendarPastorLimit(auth.user.id, "share");
  if (limited) return limited;
  let reset = false;
  try {
    const body = (await request.json()) as { reset?: unknown } | null;
    reset = body?.reset === true;
  } catch {
    reset = false;
  }
  try {
    const result = await calendarShare(auth, createAdminClient(), appOrigin(request), reset);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json({ share: result.share });
  } catch (error) {
    console.error("[missio-calendar] share failed", error instanceof Error ? error.message : "failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
