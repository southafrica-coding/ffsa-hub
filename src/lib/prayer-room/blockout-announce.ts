// Announce a block-out: the #devo-sets channel post plus a personal DM to
// everyone. Shared by the manual block-out form and block-outs applied from a
// Space Booking, so both say exactly the same thing the same way.

import {
  notifyPrayerRoomBlockout,
  buildBlockoutMessage,
  type BlockoutArgs,
  type SlackResult,
} from "@/lib/slack/prayer-room";
import { sendBroadcast } from "@/lib/slack/broadcast";

export async function announceBlockout(
  args: BlockoutArgs,
  actorUserId: string
): Promise<SlackResult> {
  const message = buildBlockoutMessage(args);

  // Relay the channel outcome so the UI can say why it did / didn't post
  // (not configured, bot not in channel…).
  const slack = await notifyPrayerRoomBlockout(args);

  // …and DM every person individually. A block-out moves other people's devo
  // sets, so everyone needs it — and the channel post alone relies on them
  // noticing it. Fire-and-forget: delivery is paced across ~60 DMs to stay
  // inside Slack's rate limits, and the block-out itself is already saved, so
  // nothing here may block or fail the response.
  void sendBroadcast({
    type: "prayer_room_blockout",
    title: message.title,
    blocks: message.blocks,
    body: message.body,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com"}/prayer-room`,
    actorUserId,
  }).catch((err) => {
    console.error("[prayer-room/blockouts] broadcast failed", err);
  });

  return slack;
}
