/**
 * POST /api/slack/events — inbound Slack events for the Q&A bot.
 *
 * Handles the Events API: the url_verification handshake, plus
 * app_mention (channel @mentions) and message.im (DMs). Flow:
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
import crypto from "node:crypto";
import { isAllowed } from "@/lib/slack/assistant/access";
import { runAssistant } from "@/lib/slack/assistant/run";
import * as slack from "@/lib/slack/client";
import { getActiveSession } from "@/lib/hub-feedback/store";
import { handleTurn } from "@/lib/hub-feedback/conversation";

export const maxDuration = 60; // covers the after() agent work
export const dynamic = "force-dynamic";

function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // Replay guard: reject timestamps more than 5 minutes off.
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — length-guard first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
      user?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
      files?: Array<{
        id: string;
        name?: string;
        mimetype?: string;
        permalink?: string;
        url_private?: string;
      }>;
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

  // Ignore anything the bot itself posted.
  if (event.bot_id) {
    return NextResponse.json({ ok: true });
  }

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  if ((!isMention && !isDM) || !event.channel || !event.user) {
    return NextResponse.json({ ok: true });
  }

  // Feedback intake: a DM from a user with an ACTIVE intake session is
  // handled by the feedback bot, not the Q&A assistant. Accept plain
  // messages and file shares (screenshots); ignore edits/other subtypes.
  if (isDM && (!event.subtype || event.subtype === "file_share")) {
    const session = await getActiveSession(event.user);
    if (session) {
      const newMedia = (event.files ?? []).map((f) => ({
        slack_file_id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        permalink: f.permalink,
        url_private: f.url_private,
      }));
      const userText =
        cleanText(event.text ?? "") || (newMedia.length ? "(shared a screenshot)" : "");
      if (userText || newMedia.length) {
        const evId = body.event_id ?? null;
        after(async () => {
          try {
            await handleTurn({ session, text: userText, newMedia, eventId: evId });
          } catch (err) {
            console.error("[slack/events] intake turn failed", err);
          }
        });
      }
      return NextResponse.json({ ok: true });
    }
  }

  // (5) For the Q&A path, ignore edits/joins/file-shares and other subtypes.
  if (event.subtype) {
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
