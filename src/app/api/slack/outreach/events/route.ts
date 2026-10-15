/**
 * POST /api/slack/outreach/events — the Outreach Finance Slack app.
 *
 * A separate Slack app from FFSA Hub Activity (see lib/slack/bots), so
 * teams get a bot that only does one job: their outreach budget. It
 * handles app_mention (an @mention in a team channel) and message.im
 * (a DM). Flow mirrors /api/slack/events:
 *   1. verify the signature with THIS app's signing secret
 *   2. url_verification handshake, drop retries, ignore bots/edits
 *   3. ACK within Slack's 3s, then in after():
 *   4. resolve who is asking and which team (lib/slack/assistant/outreach)
 *   5. answer with the outreach budget tools only — never the staff tools
 *
 * Auth is by signing secret, not session cookie — /api/slack is in the
 * middleware publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { isFinanceStaff, resolveOutreachScope } from "@/lib/slack/assistant/outreach";
import { runAssistant } from "@/lib/slack/assistant/run";
import * as slack from "@/lib/slack/client";
import { botSigningSecret } from "@/lib/slack/bots";
import { verifySlackSignature } from "@/lib/slack/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubUserBySlackId } from "@/services/slack-bot";

export const maxDuration = 60; // covers the after() agent work
export const dynamic = "force-dynamic";

/** Strip <@U…> bot mentions and collapse whitespace. */
function cleanText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();
}

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
    // Creating the Slack app from its manifest makes Slack check this URL
    // before anyone can have copied the app's signing secret into Vercel.
    // Echoing the challenge reveals nothing and acts on nothing, so allow
    // that one handshake while the secret is still unset — then strict.
    if (!botSigningSecret("outreach")) {
      try {
        const probe = JSON.parse(rawBody) as { type?: string; challenge?: string };
        if (probe.type === "url_verification" && typeof probe.challenge === "string") {
          return NextResponse.json({ challenge: probe.challenge });
        }
      } catch {
        /* fall through */
      }
    }
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
  if (request.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true, skipped: "retry" });
  }
  if (body.type !== "event_callback" || !body.event) {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  // Our own posts, other bots, edits, joins…
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

  after(async () => {
    const reply = (text: string) =>
      slack
        .postMessage({ channel, text, thread_ts: threadTs, bot: "outreach" })
        .catch((err) => console.error("[slack/outreach] post failed", err));
    try {
      const admin = createAdminClient();
      const hubUserId = await resolveHubUserBySlackId(admin, slackUserId);
      const outreach = await resolveOutreachScope(admin, { hubUserId, channelId: channel, isDM });

      if (outreach.kind === "refuse") {
        await reply(outreach.reason);
        return;
      }
      if (outreach.kind === "none") {
        if (!hubUserId) {
          await reply(
            "I'm the outreach finance helper. I don't know who you are yet — link your Slack on your Hub profile, then ask again."
          );
        } else if (!isDM && (await isFinanceStaff(admin, hubUserId))) {
          // Finance staff setting up a team channel: hand them the id.
          await reply(
            `This channel isn't linked to an outreach team yet. Paste this channel's ID \`${channel}\` into the team's Slack setting in the Hub (Finance → Outreach → the team → Members), then ask again.`
          );
        } else if (!isDM) {
          await reply("This channel isn't linked to an outreach team, so I can't answer budget questions here.");
        } else {
          await reply(
            "I help outreach teams with their budget, but you're not on an outreach team that's using me yet. If you should be, ask your finance lead to add you to the team in the Hub."
          );
        }
        return;
      }

      await runAssistant({
        slackUserId,
        channelId: channel,
        isDM,
        threadTs,
        text: question,
        eventId: body.event_id ?? null,
        admin: false,
        outreach: outreach.scope,
        bot: "outreach",
      });
    } catch (err) {
      console.error("[slack/outreach] assistant failed", err);
    }
  });

  return NextResponse.json({ ok: true });
}
