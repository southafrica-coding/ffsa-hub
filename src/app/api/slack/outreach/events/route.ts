/**
 * POST /api/slack/outreach/events — the Outreach Finance Slack app.
 *
 * A separate Slack app from FFSA Hub Activity (see lib/slack/bots), so
 * teams get a bot that only does one job: their outreach budget. It
 * handles message.im (a DM) and app_mention. A channel message is a turn
 * only when it @mentions the bot. message.groups for that same mention is
 * ignored, so one photo cannot create two drafts, and ordinary chat never
 * reaches the assistant. Receipts in a channel are read only in the private
 * channel linked to that team. A public, shared, or Slack Connect channel
 * is told to move to a DM.
 * Flow mirrors /api/slack/events:
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
import { isFinanceStaff, pickTeam, resolveOutreachScope } from "@/lib/slack/assistant/outreach";
import { runAssistant } from "@/lib/slack/assistant/run";
import { loadReceiptDoor } from "@/lib/slack/outreach/channel-policy";
import { outreachEventKind } from "@/lib/slack/outreach/event-gate";
import { classifyBareMessage, parseSpendClaim, repayValue, repaymentBlocks, repaymentSentence } from "@/lib/slack/outreach/no-receipt";
import { handleIncomingReceipts } from "@/lib/slack/outreach/receipts";
import type { SlackFile } from "@/lib/slack/outreach/receipt-logic";
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
      files?: SlackFile[];
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
  // Our own posts, other bots, edits, joins… — but a message with a file
  // attached arrives as subtype file_share, and that's a receipt.
  if (event.bot_id || (event.subtype && event.subtype !== "file_share")) {
    return NextResponse.json({ ok: true });
  }

  const kind = outreachEventKind(event);
  if (kind === "ignore" || !event.channel || typeof event.user !== "string") {
    return NextResponse.json({ ok: true });
  }
  const isDM = kind === "dm";

  const question = cleanText(event.text ?? "");
  const files = event.files ?? [];
  if (!question && files.length === 0) {
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
      const receiptLike = files.length > 0 || classifyBareMessage(question) === "no_receipt";
      if (receiptLike) {
        const door = await loadReceiptDoor({ isDM, channelId: channel });
        if (!door.ok) {
          await reply(door.tell);
          return;
        }
      }

      const admin = createAdminClient();
      const hubUserId = await resolveHubUserBySlackId(admin, slackUserId);
      const outreach = await resolveOutreachScope(admin, { hubUserId, channelId: channel, isDM });

      // A channel receipt or no-receipt claim is only read in the private channel linked to that team.
      if (!isDM && receiptLike && (outreach.kind !== "ok" || !outreach.scope.inTeamChannel)) {
        await reply(
          "Send the photo in a direct message, or @mention me in the private channel linked to that outreach team."
        );
        return;
      }

      // A spend with no photo is a repayment even when this person can't see
      // the budget. It never becomes an expense and it never goes to Xero.
      if (files.length === 0 && classifyBareMessage(question) === "no_receipt") {
        if (!hubUserId) {
          await reply(
            "I'm the outreach finance helper. I don't know who you are yet — link your Slack on your Hub profile, then tell me again."
          );
          return;
        }
        const picked = outreach.kind === "ok" ? pickTeam(outreach.scope) : { ok: false as const };
        const teamName = picked.ok ? picked.team.team_name : null;
        const teamId = picked.ok ? picked.team.id : null;
        const claim = parseSpendClaim(question);
        const text = repaymentSentence(claim, teamName);
        const value = claim
          ? repayValue({
              amountCents: Math.round(claim.amount * 100),
              currency: claim.currency,
              teamId,
              claimantSlackId: slackUserId,
              description: claim.description,
            })
          : null;
        await slack
          .postMessage({
            channel,
            text: text.replace(/\*/g, ""),
            blocks: repaymentBlocks(text, value),
            thread_ts: threadTs,
            bot: "outreach",
          })
          .catch((err) => console.error("[slack/outreach] repayment post failed", err));
        return;
      }

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

      if (files.length > 0) {
        await handleIncomingReceipts({
          files,
          slackUserId,
          hubUserId,
          channelId: channel,
          threadTs,
          userNote: question || null,
          scope: outreach.scope,
        });
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
