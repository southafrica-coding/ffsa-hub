/**
 * Prayer Room → Slack: block-out / relocation announcements.
 *
 * Posts a heads-up to the dedicated prayer-room channel when a manager blocks
 * out a time and devo sets have to move. Channel id comes from the
 * SLACK_PRAYER_ROOM_CHANNEL_ID env var (distinct from #ffsa-activity).
 *
 * Fire-and-forget: no-ops with a warning if Slack isn't configured, and
 * swallows its own errors so a Slack outage never blocks the block-out write.
 */

import * as slack from "./client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return `${DAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
const hhmm = (t: string) => (t ?? "").slice(0, 5);

export type AffectedSet = {
  title: string;
  startTime: string;
  endTime: string;
  owner: string | null;
};

export async function notifyPrayerRoomBlockout(args: {
  blockDate: string;
  startTime: string;
  endTime: string;
  reason: string | null;
  relocationNote: string | null;
  affected: AffectedSet[];
}): Promise<void> {
  const channel = process.env.SLACK_PRAYER_ROOM_CHANNEL_ID;
  if (!process.env.SLACK_BOT_TOKEN || !channel) {
    console.warn(
      "[slack/prayer-room] SLACK_BOT_TOKEN or SLACK_PRAYER_ROOM_CHANNEL_ID missing — skipping block-out post"
    );
    return;
  }

  const when = `${dateLabel(args.blockDate)}, ${hhmm(args.startTime)}–${hhmm(args.endTime)}`;
  const title = `🚧 Prayer room blocked out — ${when}`;

  const lines: string[] = [`*${title}*`];
  if (args.reason) lines.push(`*Reason:* ${args.reason}`);
  lines.push(
    `*Devo sets move to:* ${args.relocationNote?.trim() || "_to be confirmed_"}`
  );

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];

  if (args.affected.length > 0) {
    const setLines = args.affected
      .map(
        (s) =>
          `• ${hhmm(s.startTime)}–${hhmm(s.endTime)} — ${s.title}${s.owner ? ` (led by ${s.owner})` : ""}`
      )
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${args.affected.length} set(s) affected:*\n${setLines}` },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No devo sets were scheduled in this window._" },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `<${APP_URL}/prayer-room|Open the prayer room schedule>` }],
  });

  try {
    const res = await slack.postMessage({ channel, text: title, blocks });
    if (!res.ok) console.error("[slack/prayer-room] postMessage failed", res.error);
  } catch (err) {
    console.error("[slack/prayer-room] post threw", err);
  }
}
