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
  /** Which day the set falls on — shown when a block-out spans multiple days. */
  date: string;
  startTime: string;
  endTime: string;
  owner: string | null;
};

/** Outcome of the post, so the route can tell the user why it did / didn't land. */
export type SlackResult = {
  ok: boolean;
  skipped?: string;
  error?: string;
  /** Populated on failure to diagnose config issues straight from the UI. */
  debug?: { channelLen: number; team: string | null };
};

// On failure we surface two things the user otherwise can't see: the length of
// the channel value the server actually received (catches a stray space/newline
// in the env var — a correct id is 11 chars) and which Slack workspace the bot
// token belongs to (catches a token from the wrong workspace).
async function debugInfo(channel: string): Promise<{ channelLen: number; team: string | null }> {
  let team: string | null = null;
  try {
    const a = await slack.authTest();
    team = a.ok ? a.team ?? null : `auth_error:${a.error ?? "unknown"}`;
  } catch {
    team = "auth_unreachable";
  }
  return { channelLen: channel.length, team };
}

export type BlockoutArgs = {
  blockDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  relocationNote: string | null;
  affected: AffectedSet[];
  /** Separate dates (e.g. a weekly booking applied at once). When set, the
   *  message lists them instead of reading blockDate → endDate as one span. */
  dates?: string[];
  /** The dates carry different time windows, so no single window is named. */
  timesVary?: boolean;
};

/**
 * Build the block-out message once, so the #devoset-communication
 * channel post and the personal DM broadcast say exactly the same
 * thing. Two renderings of the same announcement drifting apart is
 * how people end up acting on different information.
 */
export function buildBlockoutMessage(args: BlockoutArgs): {
  title: string;
  blocks: unknown[];
  body: string;
} {
  // Span first: one day → "Sat 4 Jul", a range → "Sat 4 Jul → Fri 10 Jul".
  // Separate dates list out instead (≤4 by name, more as a count + span).
  const separate = (args.dates?.length ?? 0) > 1 ? args.dates! : null;
  const multiDay = !!separate || (args.endDate && args.endDate !== args.blockDate);
  const dateSpan = separate
    ? separate.length <= 4
      ? separate.map(dateLabel).join(", ")
      : `${separate.length} dates, ${dateLabel(separate[0])} → ${dateLabel(separate[separate.length - 1])}`
    : multiDay
      ? `${dateLabel(args.blockDate)} → ${dateLabel(args.endDate)}`
      : dateLabel(args.blockDate);
  // Then the window: null times mean the room is out all day.
  const allDay = !args.startTime || !args.endTime;
  const when = args.timesVary
    ? `${dateSpan} — times vary`
    : allDay
      ? `${dateSpan} — all day`
      : `${dateSpan}, ${hhmm(args.startTime!)}–${hhmm(args.endTime!)}`;
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
      .map((s) => {
        const day = multiDay ? `${dateLabel(s.date)} · ` : "";
        return `• ${day}${hhmm(s.startTime)}–${hhmm(s.endTime)} — ${s.title}${s.owner ? ` (led by ${s.owner})` : ""}`;
      })
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

  return { title, blocks, body: lines.join("\n") };
}

export async function notifyPrayerRoomBlockout(
  args: BlockoutArgs
): Promise<SlackResult> {
  const channel = process.env.SLACK_PRAYER_ROOM_CHANNEL_ID;
  if (!process.env.SLACK_BOT_TOKEN || !channel) {
    console.warn(
      "[slack/prayer-room] SLACK_BOT_TOKEN or SLACK_PRAYER_ROOM_CHANNEL_ID missing — skipping block-out post"
    );
    return { ok: false, skipped: "not_configured" };
  }

  const { title, blocks } = buildBlockoutMessage(args);

  try {
    const res = await slack.postMessage({ channel, text: title, blocks });
    if (!res.ok) {
      console.error("[slack/prayer-room] postMessage failed", res.error);
      return { ok: false, error: res.error ?? "unknown", debug: await debugInfo(channel) };
    }
    return { ok: true };
  } catch (err) {
    console.error("[slack/prayer-room] post threw", err);
    return { ok: false, error: err instanceof Error ? err.message : "threw", debug: await debugInfo(channel) };
  }
}
