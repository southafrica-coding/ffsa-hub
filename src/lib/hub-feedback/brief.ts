/**
 * Block Kit rendering for the private #hub-triage channel and the
 * reporter-facing DM messages.
 */

import type { Classification, HubIssue, IssueLane, MediaRef } from "./types";

export const ACTION_HANDLED = "hub_fb_handled";
export const ACTION_DISMISS = "hub_fb_dismiss";

const TYPE_EMOJI: Record<string, string> = {
  bug: "🐛",
  idea: "💡",
  question: "❓",
};

const LANE_LABEL: Record<IssueLane, string> = {
  auto_ship: "Auto-ship candidate (cosmetic/small — Lane A)",
  build_on_approval: "Needs your sign-off (Lane B)",
  product_decision: "Product decision (your call)",
};

function mediaLine(media: MediaRef[]): string | null {
  if (!media.length) return null;
  const links = media
    .map((m, i) =>
      m.permalink ? `<${m.permalink}|📎 ${m.name ?? `file ${i + 1}`}>` : null
    )
    .filter(Boolean);
  return links.length ? links.join("  ") : `📎 ${media.length} attachment(s)`;
}

/**
 * The triage brief posted to #hub-triage when a NEW issue is created.
 * Buttons let you close the loop without leaving Slack.
 */
export function renderIssueBrief(
  issue: HubIssue,
  classification: Classification,
  reporterName: string | null
): { text: string; blocks: unknown[] } {
  const emoji = TYPE_EMOJI[issue.type] ?? "•";
  const metaBits = [
    issue.area ? `*Area:* ${issue.area}` : null,
    issue.size ? `*Size:* ${issue.size.replace("_", " ")}` : null,
    issue.danger_zone ? "⚠️ *danger-zone*" : null,
    `*Reporters:* ${issue.reporter_count}`,
  ].filter(Boolean);

  const laneNote =
    issue.proposed_lane === "auto_ship"
      ? "_Auto-ship isn't switched on yet (Phase 3) — logged for now._"
      : "";

  const media = mediaLine(issue.media);

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${issue.title}`.slice(0, 150) },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: issue.summary },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: metaBits.join("  •  ") },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Proposed:* ${LANE_LABEL[classification.proposed_lane]}${
            classification.reason ? ` — ${classification.reason}` : ""
          }`,
        },
      ],
    },
  ];

  if (media) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: media }],
    });
  }
  if (reporterName) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `First reported by ${reporterName}` }],
    });
  }
  if (laneNote) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: laneNote }],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Mark handled" },
        style: "primary",
        action_id: ACTION_HANDLED,
        value: issue.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🗑️ Dismiss" },
        action_id: ACTION_DISMISS,
        value: issue.id,
      },
    ],
  });

  return { text: `${emoji} ${issue.title}`, blocks };
}

/** Threaded note added to a brief when another person reports the same thing. */
export function duplicateNote(count: number, reporterName: string | null): string {
  const who = reporterName ? `${reporterName} ` : "Someone ";
  return `➕ ${who}reported this too — now *${count}* reporters.`;
}

// ── Reporter-facing DM copy ─────────────────────────────────

export function ackNew(type: string, title: string): string {
  const emoji = TYPE_EMOJI[type] ?? "✅";
  const noun = type === "idea" ? "idea" : "report";
  return `${emoji} Thanks — your ${noun} is logged: *${title}*. The team will take it from here, and I'll message you when there's an update. 🙏`;
}

export function ackDuplicate(title: string): string {
  return `➕ Good news — someone already reported this (*${title}*), so I've added you to it rather than creating a duplicate. You're on the list and we'll only fix it once. 🙏`;
}
