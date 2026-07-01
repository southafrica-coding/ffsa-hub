/**
 * POST /api/slack/interactivity — Slack interactive components.
 *
 * Two payload kinds:
 *   • shortcut  — the global "Report an issue" shortcut → start intake.
 *   • block_actions — a button on a #hub-triage brief (Mark handled /
 *     Dismiss) → update the issue + reflect status on the message.
 *
 * Slack posts application/x-www-form-urlencoded with a single `payload`
 * field (JSON). Ack within 3s; do the work in the background.
 */

import { after, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import * as slack from "@/lib/slack/client";
import { startIntake } from "@/lib/hub-feedback/intake";
import * as store from "@/lib/hub-feedback/store";
import { ACTION_HANDLED, ACTION_DISMISS } from "@/lib/hub-feedback/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REPORT_SHORTCUT_CALLBACK = "report_issue";

type Payload = {
  type?: string;
  callback_id?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; text?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackRequest(rawBody, request.headers)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const encoded = new URLSearchParams(rawBody).get("payload");
  if (!encoded) return NextResponse.json({ ok: true });

  let payload: Payload;
  try {
    payload = JSON.parse(encoded) as Payload;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  // Global shortcut → start a DM intake.
  if (payload.type === "shortcut" && payload.callback_id === REPORT_SHORTCUT_CALLBACK) {
    const userId = payload.user?.id;
    if (userId) {
      after(async () => {
        try {
          await startIntake(userId);
        } catch (err) {
          console.error("[slack/interactivity] shortcut intake failed", err);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Button on a triage brief.
  if (payload.type === "block_actions" && payload.actions?.length) {
    const action = payload.actions[0];
    const issueId = action.value;
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;
    const clicker = payload.user?.id;

    if (issueId && (action.action_id === ACTION_HANDLED || action.action_id === ACTION_DISMISS)) {
      const handled = action.action_id === ACTION_HANDLED;
      after(async () => {
        try {
          await store.setIssueStatus(issueId, handled ? "shipped" : "dismissed");
          if (channel && ts) {
            const label = handled ? "✅ Marked handled" : "🗑️ Dismissed";
            const by = clicker ? ` by <@${clicker}>` : "";
            const original = payload.message?.text ?? "";
            await slack.updateMessage({
              channel,
              ts,
              text: `${original}\n\n${label}${by}`,
              blocks: [
                { type: "section", text: { type: "mrkdwn", text: `~${original}~` } },
                { type: "context", elements: [{ type: "mrkdwn", text: `${label}${by}` }] },
              ],
            });
          }
        } catch (err) {
          console.error("[slack/interactivity] action failed", err);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
