/**
 * GET /api/cron/hub-triage-digest
 *
 * Daily digest of Hub feedback (last 24h) DM'd to each admin in
 * HUB_ADMIN_SLACK_IDS (comma-separated Slack user ids). Lets admins
 * skip watching #hub-triage live.
 *
 * Schedule: configured in vercel.json. Auth: Bearer ${CRON_SECRET},
 * same pattern as the other crons.
 */

import { NextResponse } from "next/server";
import * as slack from "@/lib/slack/client";
import { buildDigest } from "@/lib/hub-feedback/digest";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json(
      { skipped: true, reason: "SLACK_BOT_TOKEN not configured" },
      { status: 200 }
    );
  }

  const admins = (process.env.HUB_ADMIN_SLACK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!admins.length) {
    return NextResponse.json(
      { skipped: true, reason: "HUB_ADMIN_SLACK_IDS not set" },
      { status: 200 }
    );
  }

  let digest;
  try {
    digest = await buildDigest();
  } catch (err) {
    console.error("[hub-triage-digest] build failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  let delivered = 0;
  for (const userId of admins) {
    try {
      const conv = await slack.openConversation(userId);
      const dm = conv.ok ? conv.channel?.id : undefined;
      if (!dm) continue;
      const res = await slack.postMessage({
        channel: dm,
        text: digest.text,
        blocks: digest.blocks,
      });
      if (res.ok) delivered += 1;
    } catch (err) {
      console.error("[hub-triage-digest] deliver failed", userId, err);
    }
  }

  return NextResponse.json({ delivered, admins: admins.length, items: digest.count });
}
