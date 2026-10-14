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
 *   6. ACK 200 within Slack's 3s window
 *   7. in the background (after()), decide what this conversation may use:
 *        - an outreach team conversation (team channel, or a DM from
 *          someone on a Slack-enabled team) → that team's budget tools
 *          (lib/slack/assistant/outreach)
 *        - the staff allowlist (access.ts) → the staff Q&A tools
 *      and refuse when it is neither
 *   8. run the assistant
 *
 * Auth is by signing secret, not session cookie — so /api/slack is in
 * the middleware publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { isAllowed } from "@/lib/slack/assistant/access";
import { isFinanceStaff, resolveOutreachScope } from "@/lib/slack/assistant/outreach";
import { resolveHubUserBySlackId } from "@/services/slack-bot";
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

  const question = cleanText(event.text ?? "");
  if (!question) {
    return NextResponse.json({ ok: true });
  }

  const channel = event.channel;
  const slackUserId = event.user;
  const threadTs = isDM ? undefined : (event.thread_ts ?? event.ts);
  const gate = isAllowed({ channelId: channel, userId: slackUserId, isDM });

  // (6) ACK now; work out access and answer after the response flushes —
  // the outreach lookup needs the database, which can't race Slack's 3s.
  after(async () => {
    const refuse = (text: string) =>
      slack.postMessage({ channel, text, thread_ts: threadTs }).catch((err) =>
        console.error("[slack/events] refusal post failed", err)
      );
    try {
      const admin = createAdminClient();
      const hubUserId = await resolveHubUserBySlackId(admin, slackUserId);
      const outreach = await resolveOutreachScope(admin, { hubUserId, channelId: channel, isDM });

      if (outreach.kind === "refuse") {
        await refuse(outreach.reason);
        return;
      }
      // A team channel is read by the whole team: budget tools only, never
      // the staff tools (contacts, names) — even for allowlisted staff.
      const staffTools = gate.ok && !(outreach.kind === "ok" && outreach.scope.inTeamChannel);

      if (!staffTools && outreach.kind !== "ok") {
        let reason = gate.ok ? "I can't answer here." : gate.reason;
        // Finance staff @mentioning the bot in an unlinked channel are
        // probably setting up a team channel: hand them the id to paste.
        if (!isDM && hubUserId && (await isFinanceStaff(admin, hubUserId))) {
          reason += `\nTo use me for an outreach team's budget here, paste this channel's ID \`${channel}\` into the team's Slack setting in the Hub (Finance → Outreach → the team → Members).`;
        }
        await refuse(reason);
        return;
      }

      await runAssistant({
        slackUserId,
        channelId: channel,
        isDM,
        threadTs,
        text: question,
        eventId: body.event_id ?? null,
        admin: staffTools,
        outreach: outreach.kind === "ok" ? outreach.scope : null,
      });
    } catch (err) {
      console.error("[slack/events] assistant failed", err);
    }
  });

  return NextResponse.json({ ok: true });
}
