/**
 * POST /api/slack/commands — Slack slash commands.
 *
 * Handles `/report-issue`: opens a private DM intake conversation with
 * the invoking user. Slack sends application/x-www-form-urlencoded and
 * expects a 200 within 3s, so the DM work runs in the background.
 *
 * Auth: Slack signing secret (this path is under the /api/slack public
 * prefix in middleware).
 */

import { after, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { startIntake } from "@/lib/hub-feedback/intake";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackRequest(rawBody, request.headers)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const userId = params.get("user_id");

  if (command !== "/report-issue" || !userId) {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      await startIntake(userId);
    } catch (err) {
      console.error("[slack/commands] startIntake failed", err);
    }
  });

  // Ephemeral ack shown only to the invoker in-place.
  return NextResponse.json({
    response_type: "ephemeral",
    text: "📩 I've sent you a DM — let's sort it out there.",
  });
}
