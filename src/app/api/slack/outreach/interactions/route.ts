/**
 * POST /api/slack/outreach/interactions — button clicks on Outreach
 * Finance messages (the receipt "Log it / Change / Cancel" card arrives
 * with receipts). Registered in the app manifest now so the Slack app
 * doesn't need re-configuring later; until then it only acknowledges.
 */

import { NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
      "outreach"
    )
  ) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  return new NextResponse(null, { status: 200 });
}
