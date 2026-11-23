/**
 * "Report a problem" from the Hub assistant: one row in
 * slack_assistant_tickets for the Hub team, with the read-only checks the
 * assistant ran first (investigate.ts) as its evidence — in the evidence
 * column (migration 393) and, briefly, under the message.
 *
 * Nothing here runs when the tool is called. The tool investigates and
 * proposes; the report is filed only when the leader presses the button
 * (actions.ts, after the usual re-checks and claim), which calls
 * fileTicket. If SLACK_ASSISTANT_TICKET_CHANNEL_ID is set, a short note
 * goes to that channel too (the "Hub" app has to be invited to it);
 * unset, nothing is posted and the report still counts as filed.
 */

import * as slack from "@/lib/slack/client";
import * as data from "./data";
import type { Evidence } from "./investigate";
import type { Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const MAX_MESSAGE = 4000;

const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The checks, briefly, for the message itself (and the channel note). */
export function evidenceText(e: Evidence): string {
  const lines = [...e.findings.map((f) => `- ${f}`), ...e.could_not_check.map((c) => `- Couldn't check: ${c}`)];
  return lines.length > 0 ? `\n\nWhat the assistant checked (read-only):\n${lines.join("\n")}`.slice(0, 1500) : "";
}

/** The ministries a report is filed under: the ones they lead, else the ones they point-lead. */
export function reportMinistries(leader: Leader) {
  return leader.ministries.length > 0 ? leader.ministries : leader.pointLeaderOf;
}

/**
 * Insert the ticket and, if a channel is set, post the note. Only called
 * from Confirm. Auditing is the caller's (actions.ts).
 */
export async function fileTicket(
  admin: Client,
  leader: Leader,
  message: string,
  evidence?: Evidence
): Promise<{ ok: true; ticketId: string } | { ok: false }> {
  const extra = evidence ? evidenceText(evidence) : "";
  const text = message.slice(0, MAX_MESSAGE - extra.length) + extra;
  const ministries = reportMinistries(leader);
  const ticketId = await data.insertTicket(admin, {
    reporter_hub_user_id: leader.hubUserId,
    slack_user_id: leader.slackUserId,
    ministry_ids: ministries.map((m) => m.id),
    ministry_names: ministries.map((m) => m.name),
    message: text,
    ...(evidence ? { evidence } : {}),
  });
  if (!ticketId) return { ok: false };

  const channel = process.env.SLACK_ASSISTANT_TICKET_CHANNEL_ID?.trim();
  if (channel) {
    const who = ministries.map((m) => m.name).join(", ");
    await slack
      .postMessage({
        channel,
        bot: "assistant",
        text: `New problem report from <@${leader.slackUserId}> (${escape(who)}):\n>${escape(text.slice(0, 500)).replace(/\n/g, "\n>")}`,
      })
      .catch((err) => console.error("[slack/hub-assistant] ticket notice failed", err));
  }
  return { ok: true, ticketId };
}
