/**
 * Where a receipt may arrive.
 *
 * The default is a direct message with the Outreach Finance bot. A private
 * channel the bot is in (the team's bot channel) is the only other door.
 * A public channel, a group DM, or a channel we can't prove is private is
 * refused — the photo is not downloaded and nothing is logged.
 */

import * as slack from "@/lib/slack/client";

export type SlackChannelPrivacy = {
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  /** False when the bot has not been invited. Absent means we don't know. */
  is_member?: boolean;
  /** Slack Connect or a channel shared outside this workspace. */
  is_shared?: boolean;
  is_ext_shared?: boolean;
  is_org_shared?: boolean;
};

export type ReceiptDoor =
  | { ok: true; place: "dm" | "private_channel" }
  | { ok: false; tell: string };

export const PUBLIC_CHANNEL_TELL =
  "Send the photo to me in a direct message. I only take receipts there, or in the team's private channel. This channel is public, so I won't read it here.";

export const GROUP_DM_TELL =
  "Send the photo in a direct message with me, not a group message. A private team channel works too.";

export const UNKNOWN_CHANNEL_TELL =
  "I couldn't confirm this channel is private, so I won't read a receipt here. Send the photo to me in a direct message.";

export const SHARED_CHANNEL_TELL =
  "This channel is shared outside the workspace, so I won't read a receipt here. Send the photo in a direct message, or in the team's own private channel.";

export function channelIsShared(channel: SlackChannelPrivacy | null | undefined): boolean {
  return Boolean(channel?.is_shared || channel?.is_ext_shared || channel?.is_org_shared);
}

export function receiptDoor(args: { isDM: boolean; channel: SlackChannelPrivacy | null }): ReceiptDoor {
  if (args.isDM || args.channel?.is_im) return { ok: true, place: "dm" };
  if (channelIsShared(args.channel)) return { ok: false, tell: SHARED_CHANNEL_TELL };
  if (args.channel?.is_mpim) return { ok: false, tell: GROUP_DM_TELL };
  if (args.channel?.is_private === true && args.channel.is_member !== false) {
    return { ok: true, place: "private_channel" };
  }
  if (args.channel?.is_private === false) return { ok: false, tell: PUBLIC_CHANNEL_TELL };
  return { ok: false, tell: UNKNOWN_CHANNEL_TELL };
}

/** DM needs no lookup. Anything else is checked with Slack, and a failed check stays shut. */
export async function loadReceiptDoor(args: { isDM: boolean; channelId: string }): Promise<ReceiptDoor> {
  if (args.isDM || args.channelId.startsWith("D")) return { ok: true, place: "dm" };
  try {
    const info = await slack.conversationInfo(args.channelId, "outreach");
    if (!info.ok || !info.channel) return receiptDoor({ isDM: false, channel: null });
    return receiptDoor({ isDM: false, channel: info.channel });
  } catch (err) {
    console.error("[slack/outreach] channel privacy check failed", err);
    return receiptDoor({ isDM: false, channel: null });
  }
}
