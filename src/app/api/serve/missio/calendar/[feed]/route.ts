import { NextResponse } from "next/server";
import { publicFeedClient, readCalendarByToken } from "@/lib/missio/calendar/data";
import { buildMissioFeed } from "@/lib/missio/calendar/ics";
import { calendarFeedLimit } from "@/lib/missio/calendar/limit";
import { allNationalEvents } from "@/lib/missio/calendar/south-africa";
import { hashCalendarToken, tokenFromSegment } from "@/lib/missio/calendar/token";

// GET /api/serve/missio/calendar/<token>.ics   Public, no login. The Missio
// calendar as an iCalendar feed for Google, Apple and Outlook to subscribe
// to. ?national=0 leaves out public holidays and school terms.
// The token is the only key and is never logged. A wrong or reset token is
// a plain 404 that says nothing about whether a calendar exists.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ feed: string }> };

function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: Request, context: Ctx) {
  const { feed } = await context.params;
  const raw = tokenFromSegment(feed);
  const limited = await calendarFeedLimit(request, raw ? hashCalendarToken(raw) : null);
  if (limited) return limited;
  if (!raw) return notFound();

  try {
    const result = await readCalendarByToken(publicFeedClient(), raw);
    if (!result.ok) {
      if (result.status === 404) return notFound();
      return new NextResponse("Try again later", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
    }
    const url = new URL(request.url);
    const national = url.searchParams.get("national") !== "0";
    const body = buildMissioFeed({
      name: result.name,
      events: national ? [...result.events, ...allNationalEvents()] : result.events,
      uidDomain: "missio.ffsahub",
    });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="missio.ics"',
        // Private: no shared cache keeps a reset link alive.
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("[serve/missio/calendar]", error instanceof Error ? error.message : "failed");
    return new NextResponse("Try again later", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
  }
}
