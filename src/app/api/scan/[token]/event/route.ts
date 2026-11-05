import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { resolveScanLink } from "@/services/event-scan-links";

// GET /api/scan/[token]/event: which event this door link belongs to.
//
// The website's /scan/[token] page reads the title server-side; the phone
// app's volunteer door has no server render, so it asks here. Same
// credential (the token in the path), same rate-limit bucket and same dead-link
// answer as /api/scan/[token], so it opens nothing that route doesn't.
// Title and start date only: never ids, tokens or guest data.
// (Lives under /api/scan so middleware already treats it as public.)

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_PER_WINDOW = 120;
const WINDOW_SECONDS = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const limit = await getRateLimiter().hit(`scan:${token}:${clientIp(request)}`, {
    limit: MAX_PER_WINDOW,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Wait a moment and try again." },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds(limit)) },
      }
    );
  }

  const link = await resolveScanLink(createAdminClient(), token);
  if (!link) {
    return NextResponse.json(
      {
        error:
          "This scanning link is no longer active. Ask the event organiser for a current one.",
      },
      { status: 404, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { event: { title: link.event.title, startDate: link.event.start_date } },
    { headers: NO_STORE }
  );
}
