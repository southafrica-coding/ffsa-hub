/**
 * POST /api/slack/events — inbound Slack events for the Q&A bot.
 *
 * Handles the Events API: the url_verification handshake, plus
 * app_mention (channel @mentions) and message.im (DMs), and user_change
 * (someone deactivated in Slack → their HUB account is switched off, see
 * lib/slack/deactivation). Flow:
 *   1. read the RAW body (needed for HMAC) before parsing
 *   2. verify the Slack signature + reject stale timestamps
 *   3. answer the url_verification challenge
 *   4. drop Slack retries (we already accepted the first delivery)
 *   5. ignore bot/own/edited messages
 *   6. gate on the channel + user allowlist
 *   7. ACK 200 within Slack's 3s window
 *   8. run the assistant in the background via after()
 *
 * Auth is by signing secret, not session cookie — so /api/slack is in
 * the middleware publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { isAllowed } from "@/lib/slack/assistant/access";
import { runAssistant } from "@/lib/slack/assistant/run";
import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleSlackDeactivation } from "@/lib/slack/deactivation";
import { verifySlackSignature } from "@/lib/slack/verify";

export const maxDuration = 60; // covers the after() agent work
export const dynamic = "force-dynamic";

/** Strip leading <@U…> bot mentions and collapse whitespace. */
function cleanText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ts = request.headers.get("x-slack-request-timestamp");
  const sig = request.headers.get("x-slack-signature");

  if (!verifySlackSignature(rawBody, ts, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: {
    type?: string;
    challenge?: string;
    event_id?: string;
    event?: {
      type?: string;
      subtype?: string;
      bot_id?: string;
      channel_type?: string;
      channel?: string;
      // A user id on messages; user_change carries the whole member object.
      user?: string | { id?: string; deleted?: boolean };
      text?: string;
      ts?: string;
      thread_ts?: string;
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // (3) URL verification handshake — Slack sends this once.
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // (4) Drop retries — we already accepted the original delivery.
  if (request.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true, skipped: "retry" });
  }

  if (body.type !== "event_callback" || !body.event) {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;

  // Workspace member changed. Only deactivation matters to us; Slack fires
  // this for every profile edit too, so everything else is a no-op.
  if (event.type === "user_change") {
    const member = typeof event.user === "object" ? event.user : null;
    if (member?.id && member.deleted === true) {
      const slackUserId = member.id;
      after(async () => {
        try {
          const result = await handleSlackDeactivation(
            createAdminClient(),
            slackUserId,
            "event"
          );
          console.log("[slack/events] user_change deactivation", slackUserId, result.outcome);
        } catch (err) {
          console.error("[slack/events] deactivation failed", slackUserId, err);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  // (5) Ignore bot messages, our own posts, and edits/joins/etc.
  if (event.bot_id || event.subtype) {
    return NextResponse.json({ ok: true });
  }

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  if ((!isMention && !isDM) || !event.channel || typeof event.user !== "string") {
    return NextResponse.json({ ok: true });
  }

  // (6) Allowlist gate.
  const gate = isAllowed({ channelId: event.channel, userId: event.user, isDM });
  if (!gate.ok) {
    const channel = event.channel;
    const threadTs = isDM ? undefined : (event.thread_ts ?? event.ts);
    after(async () => {
      try {
        await slack.postMessage({ channel, text: gate.reason, thread_ts: threadTs });
      } catch (err) {
        console.error("[slack/events] refusal post failed", err);
      }
    });
    return NextResponse.json({ ok: true });
  }

  const question = cleanText(event.text ?? "");
  if (!question) {
    return NextResponse.json({ ok: true });
  }

  // (7+8) ACK now; do the heavy work after the response flushes.
  const ctx = {
    slackUserId: event.user,
    channelId: event.channel,
    isDM,
    threadTs: isDM ? undefined : (event.thread_ts ?? event.ts),
    text: question,
    eventId: body.event_id ?? null,
  };
  after(async () => {
    try {
      await runAssistant(ctx);
    } catch (err) {
      console.error("[slack/events] assistant failed", err);
    }
  });

  return NextResponse.json({ ok: true });
}
