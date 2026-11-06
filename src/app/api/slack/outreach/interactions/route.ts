/**
 * POST /api/slack/outreach/interactions — button clicks and form submits
 * on Outreach Finance messages: the receipt / cash-pull card's Team menu,
 * [Log …] [Change] [Cancel], and both Change forms (lib/slack/outreach).
 *
 * Slack wants an answer within 3s, so the work runs in after(). The
 * Change form is the exception: its trigger_id expires in 3s, so it is
 * opened before answering. Replies to the clicker are ephemeral (only they
 * see them) via the interaction's response_url.
 *
 * Auth is by this app's signing secret — /api/slack is in the middleware
 * publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import {
  ACTION_CANCEL,
  ACTION_CHANGE,
  ACTION_LOG,
  ACTION_TEAM,
  VIEW_CHANGE,
  parseChange,
  parseTeamOption,
} from "@/lib/slack/outreach/receipt-logic";
import {
  applyChangeAndLog,
  applyPullChangeAndLog,
  cancelReceipt,
  chooseTeam,
  confirmCardPayment,
  logReceipt,
  openChangeForm,
  type Reply,
} from "@/lib/slack/outreach/receipts";
import * as slack from "@/lib/slack/client";
import { parsePullChange, VIEW_PULL_CHANGE } from "@/lib/slack/outreach/pull-logic";
import { ACTION_CARD_CONFIRM } from "@/lib/slack/outreach/card-logic";
import { ACTION_REPAY } from "@/lib/slack/outreach/no-receipt";
import { confirmRepayment } from "@/lib/slack/outreach/repayments";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Payload = {
  type: "block_actions" | "view_submission" | string;
  user: { id: string };
  trigger_id?: string;
  response_url?: string;
  channel?: { id: string };
  actions?: { action_id: string; value?: string; selected_option?: { value: string } }[];
  view?: {
    callback_id: string;
    private_metadata: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: { values: any };
  };
};

/** A reply only the clicker sees, under the card. */
function ephemeral(responseUrl: string | undefined): Reply {
  return async (text: string) => {
    if (!responseUrl) return;
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
    }).catch(() => {});
  };
}

/** A form submit has no response_url: DM the person instead. */
function dmReply(slackUserId: string): Reply {
  return async (text: string) => {
    const dm = await slack.openConversation(slackUserId, "outreach").catch(() => null);
    const channel = dm?.ok ? dm.channel?.id : undefined;
    if (channel) await slack.postMessage({ channel, text, bot: "outreach" }).catch(() => {});
  };
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
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get("payload") ?? "");
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const slackUserId = payload.user?.id;
  if (!slackUserId) return new NextResponse(null, { status: 200 });

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id === ACTION_TEAM) {
      const picked = parseTeamOption(action.selected_option?.value);
      if (picked) {
        const reply = ephemeral(payload.response_url);
        after(() =>
          chooseTeam(picked.draftId, picked.teamId, slackUserId, reply).catch((e) => console.error("[slack/outreach] team", e))
        );
      }
      return new NextResponse(null, { status: 200 });
    }
    if (action?.action_id === ACTION_CARD_CONFIRM) {
      // A button carries "draft|expense" in value, the menu in selected_option.
      const [draftId, expenseId] = (action.value ?? action.selected_option?.value ?? "").split("|");
      if (draftId && expenseId) {
        const reply = ephemeral(payload.response_url);
        after(() =>
          confirmCardPayment(draftId, expenseId, slackUserId, reply).catch((e) => console.error("[slack/outreach] card confirm", e))
        );
      }
      return new NextResponse(null, { status: 200 });
    }
    if (action?.action_id === ACTION_REPAY) {
      const reply = ephemeral(payload.response_url);
      after(async () => {
        try {
          const result = await confirmRepayment(createAdminClient(), slackUserId, action.value);
          await reply(result.text);
        } catch (e) {
          console.error("[slack/outreach] repay", e);
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    const draftId = action?.value;
    if (!action || !draftId) return new NextResponse(null, { status: 200 });
    const reply = ephemeral(payload.response_url);

    if (action.action_id === ACTION_CHANGE && payload.trigger_id) {
      // Before the ACK: the trigger_id is only good for 3 seconds.
      await openChangeForm(draftId, payload.trigger_id, slackUserId, reply);
      return new NextResponse(null, { status: 200 });
    }
    if (action.action_id === ACTION_LOG) {
      after(() => logReceipt(draftId, slackUserId, reply).catch((e) => console.error("[slack/outreach] log", e)));
    } else if (action.action_id === ACTION_CANCEL) {
      after(() => cancelReceipt(draftId, slackUserId, reply).catch((e) => console.error("[slack/outreach] cancel", e)));
    }
    return new NextResponse(null, { status: 200 });
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === VIEW_CHANGE) {
    const parsed = parseChange(payload.view.state.values);
    if (!parsed.ok) {
      // Slack shows these under the fields and keeps the form open.
      return NextResponse.json({ response_action: "errors", errors: parsed.errors });
    }
    const draftId = payload.view.private_metadata;
    after(() =>
      applyChangeAndLog(draftId, parsed.input, slackUserId, dmReply(slackUserId)).catch((e) =>
        console.error("[slack/outreach] change", e)
      )
    );
    return NextResponse.json({ response_action: "clear" });
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === VIEW_PULL_CHANGE) {
    const parsed = parsePullChange(payload.view.state.values);
    if (!parsed.ok) return NextResponse.json({ response_action: "errors", errors: parsed.errors });
    const draftId = payload.view.private_metadata;
    after(() =>
      applyPullChangeAndLog(draftId, parsed.proposal, slackUserId, dmReply(slackUserId)).catch((e) =>
        console.error("[slack/outreach] pull change", e)
      )
    );
    return NextResponse.json({ response_action: "clear" });
  }

  return new NextResponse(null, { status: 200 });
}
