/**
 * POST /api/slack/assistant/events — the private "Hub" Slack app for
 * ministry leaders (see lib/slack/bots, docs/slack/hub-assistant.md).
 *
 * DM-only: message.im is answered; app_mention and channel messages are
 * acknowledged and ignored, so the bot never speaks in a channel.
 *   1. verify the signature with THIS app's signing secret
 *   2. url_verification handshake — answered even with the feature off,
 *      so the Slack app can be set up before go-live
 *   3. off (flag, preview, keys missing): ACK and do nothing at all
 *   4. drop retries, bots, edits; ACK within Slack's 3s
 *   5. in after(): linked account → ministry leader → the tool loop
 *      (lib/slack/assistant/hub-leader/run)
 *
 * Auth is by signing secret, not session cookie — /api/slack is in the
 * middleware publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { botSigningSecret } from "@/lib/slack/bots";
import { verifySlackSignature } from "@/lib/slack/verify";
import { hubSlackAssistantLive } from "@/lib/slack/assistant/hub-leader/flags";
import { handleLeaderMessage } from "@/lib/slack/assistant/hub-leader/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // covers the after() agent work
export const dynamic = "force-dynamic";

function challengeOf(rawBody: string): string | null {
  try {
    const probe = JSON.parse(rawBody) as { type?: string; challenge?: string };
    return probe.type === "url_verification" && typeof probe.challenge === "string" ? probe.challenge : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
      "assistant"
    )
  ) {
    // Creating the app from its manifest makes Slack check this URL before
    // its signing secret can be in Vercel. Echoing the challenge reveals
    // nothing and acts on nothing, so allow that handshake while the
    // secret is unset (as the outreach app does) — then strict.
    const challenge = botSigningSecret("assistant") ? null : challengeOf(rawBody);
    if (challenge) return NextResponse.json({ challenge });
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
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }
  // Off, on a preview, or the app's keys aren't set: say nothing, write nothing.
  if (!hubSlackAssistantLive()) {
    return NextResponse.json({ ok: true });
  }
  if (request.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true, skipped: "retry" });
  }
  if (body.type !== "event_callback" || !body.event) {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  // DMs only. Our own posts, other bots, edits, joins and files are ignored.
  const isDM = event.type === "message" && event.channel_type === "im";
  if (!isDM || event.bot_id || event.subtype || !event.channel || typeof event.user !== "string" || !event.ts) {
    return NextResponse.json({ ok: true });
  }
  const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return NextResponse.json({ ok: true });

  const msg = {
    slackUserId: event.user,
    channelId: event.channel,
    text: text.slice(0, 2000),
    ts: event.ts,
    eventId: body.event_id ?? null,
  };
  after(async () => {
    try {
      await handleLeaderMessage(createAdminClient(), msg);
    } catch (err) {
      console.error("[slack/hub-assistant] failed", err);
    }
  });

  return NextResponse.json({ ok: true });
}
