/**
 * Build the daily triage digest DM'd to Hub admins. Summarises what
 * came in over the last 24h so nobody has to watch #hub-triage live.
 */

import * as store from "./store";
import type { HubIssue } from "./types";

const TYPE_EMOJI: Record<string, string> = { bug: "🐛", idea: "💡", question: "❓" };

function line(i: HubIssue): string {
  const emoji = TYPE_EMOJI[i.type] ?? "•";
  const area = i.area ? ` · ${i.area}` : "";
  const count = i.reporter_count > 1 ? ` · ${i.reporter_count} reporters` : "";
  return `${emoji} *${i.title}*${area}${count}`;
}

export async function buildDigest(): Promise<{
  text: string;
  blocks: unknown[];
  count: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const issues = await store.issuesSince(since);

  const open = issues.filter((i) => i.status === "open");
  const needsYou = open.filter(
    (i) => i.proposed_lane === "build_on_approval" || i.proposed_lane === "product_decision"
  );
  const autoCandidates = open.filter((i) => i.proposed_lane === "auto_ship");

  const header = issues.length
    ? `📋 *Hub feedback — last 24h:* ${open.length} open (${needsYou.length} need your call, ${autoCandidates.length} small)`
    : "📋 *Hub feedback — last 24h:* nothing new. 🎉";

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
  ];

  if (needsYou.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Need your call:*\n" + needsYou.map(line).join("\n"),
      },
    });
  }
  if (autoCandidates.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Small / cosmetic:*\n" + autoCandidates.map(line).join("\n"),
      },
    });
  }

  return { text: header, blocks, count: issues.length };
}
