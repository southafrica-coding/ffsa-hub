/**
 * "Report a problem" from the Hub assistant: one row in
 * slack_assistant_tickets for the Hub team, audited. If
 * SLACK_ASSISTANT_TICKET_CHANNEL_ID is set, a short note goes to that
 * channel too (the "Hub" app has to be invited to it); unset, nothing is
 * posted and the report still counts as filed.
 */

import * as slack from "@/lib/slack/client";
import * as data from "./data";
import type { Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const MAX_MESSAGE = 4000;

export async function reportProblem(
  admin: Client,
  leader: Leader,
  message: string
): Promise<{ ok: true; ticketId: string } | { ok: false }> {
  const text = message.slice(0, MAX_MESSAGE);
  const ticketId = await data.insertTicket(admin, {
    reporter_hub_user_id: leader.hubUserId,
    slack_user_id: leader.slackUserId,
    ministry_ids: leader.ministries.map((m) => m.id),
    ministry_names: leader.ministries.map((m) => m.name),
    message: text,
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
    changes: { source: "slack_hub_assistant", ministries: leader.ministries.map((m) => m.name) },
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
    const who = leader.ministries.map((m) => m.name).join(", ");
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
