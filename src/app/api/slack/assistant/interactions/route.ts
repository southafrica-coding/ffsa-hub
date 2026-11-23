/**
 * POST /api/slack/assistant/interactions — the Confirm / Cancel buttons
 * on a change the "Hub" assistant proposed (lib/slack/assistant/
 * hub-leader/actions). The button carries only the pending action's id;
 * everything is checked again before anything is written.
 *
 * Slack wants an answer within 3s, so the work runs in after(), and the
 * result replaces the button message via the interaction's response_url.
 * With the feature off (or on a preview) a click does nothing.
 *
 * Auth is by this app's signing secret — /api/slack is in the middleware
 * publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { hubSlackAssistantLive } from "@/lib/slack/assistant/hub-leader/flags";
import {
  ACTION_CANCEL,
  ACTION_CONFIRM,
  cancelPending,
  confirmPending,
  isPendingId,
} from "@/lib/slack/assistant/hub-leader/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Payload = {
  type?: string;
  user?: { id?: string };
  response_url?: string;
  actions?: { action_id?: string; value?: string }[];
};

/** Replace the button message with the outcome (only the leader's DM has it). */
async function replaceMessage(responseUrl: string | undefined, text: string) {
  // Only ever post back to Slack's own hooks host.
  if (!responseUrl || !responseUrl.startsWith("https://hooks.slack.com/")) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replace_original: true, text }),
  }).catch(() => {});
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
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get("payload") ?? "");
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (!hubSlackAssistantLive()) return new NextResponse(null, { status: 200 });

  const slackUserId = payload.user?.id;
  const action = payload.actions?.[0];
  if (payload.type !== "block_actions" || !slackUserId || !action || !isPendingId(action.value)) {
    return new NextResponse(null, { status: 200 });
  }
  const pendingId = action.value;
  const run =
    action.action_id === ACTION_CONFIRM ? confirmPending : action.action_id === ACTION_CANCEL ? cancelPending : null;
  if (!run) return new NextResponse(null, { status: 200 });

  after(async () => {
    try {
      const result = await run(createAdminClient(), pendingId, slackUserId);
      await replaceMessage(payload.response_url, result.text);
    } catch (err) {
      console.error("[slack/hub-assistant] button failed", err);
      await replaceMessage(payload.response_url, "Something went wrong, so that change may not have been made. Check in the Hub.");
    }
  });
  return new NextResponse(null, { status: 200 });
}
