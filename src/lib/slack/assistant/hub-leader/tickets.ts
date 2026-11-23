/**
 * "Report a problem" from the Hub assistant: one row in
 * slack_assistant_tickets for the Hub team, audited, with the read-only
 * checks the assistant ran first (investigate.ts) as its evidence — in
 * the evidence column (migration 393) and, briefly, under the message. If
 * SLACK_ASSISTANT_TICKET_CHANNEL_ID is set, a short note goes to that
 * channel too (the "Hub" app has to be invited to it); unset, nothing is
 * posted and the report still counts as filed.
 */

import * as slack from "@/lib/slack/client";
import * as data from "./data";
import type { Evidence } from "./investigate";
import type { Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const MAX_MESSAGE = 4000;

/** The checks, briefly, for the message itself (and the channel note). */
function evidenceText(e: Evidence): string {
  const lines = [...e.findings.map((f) => `- ${f}`), ...e.could_not_check.map((c) => `- Couldn't check: ${c}`)];
  return lines.length > 0 ? `\n\nWhat the assistant checked (read-only):\n${lines.join("\n")}`.slice(0, 1500) : "";
}

export async function reportProblem(
  admin: Client,
  leader: Leader,
  message: string,
  evidence?: Evidence
): Promise<{ ok: true; ticketId: string } | { ok: false }> {
  const extra = evidence ? evidenceText(evidence) : "";
  const text = message.slice(0, MAX_MESSAGE - extra.length) + extra;
  const ministries = leader.ministries.length > 0 ? leader.ministries : leader.pointLeaderOf;
  const ticketId = await data.insertTicket(admin, {
    reporter_hub_user_id: leader.hubUserId,
    slack_user_id: leader.slackUserId,
    ministry_ids: ministries.map((m) => m.id),
    ministry_names: ministries.map((m) => m.name),
    message: text,
    ...(evidence ? { evidence } : {}),
  });
  if (!ticketId) {
    await data.writeAssistantAudit(admin, {
      leader_hub_user_id: leader.hubUserId,
      slack_user_id: leader.slackUserId,
      action: "report_problem",
      result: "failed",
      detail: "ticket insert failed",
    });
    return { ok: false };
  }

  await data.writeHubAudit(admin, {
    user_id: leader.hubUserId,
    action: "slack_assistant_report_problem",
    resource_type: "slack_assistant_tickets",
    resource_id: ticketId,
    changes: { source: "slack_hub_assistant", ministries: ministries.map((m) => m.name) },
  });
  await data.writeAssistantAudit(admin, {
    leader_hub_user_id: leader.hubUserId,
    slack_user_id: leader.slackUserId,
    action: "report_problem",
    payload: { ticket_id: ticketId },
    result: "executed",
  });

  const channel = process.env.SLACK_ASSISTANT_TICKET_CHANNEL_ID?.trim();
  if (channel) {
    const who = ministries.map((m) => m.name).join(", ");
    await slack
      .postMessage({
        channel,
        bot: "assistant",
        text: `New problem report from <@${leader.slackUserId}> (${who}):\n>${text.slice(0, 500).replace(/\n/g, "\n>")}`,
      })
      .catch((err) => console.error("[slack/hub-assistant] ticket notice failed", err));
  }
  return { ok: true, ticketId };
}
