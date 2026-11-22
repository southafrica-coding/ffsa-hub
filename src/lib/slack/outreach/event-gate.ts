/**
 * Which Slack events become a turn of the outreach bot.
 *
 * A direct message is a turn. A channel message is a turn only when it
 * @mentions the bot. message.groups for that same mention is ignored, so
 * one photo cannot create two drafts. Ordinary chat in a private channel
 * is not a turn.
 */

export type OutreachEventKind = "dm" | "mention" | "ignore";

export function outreachEventKind(event: {
  type?: string;
  channel?: string;
  channel_type?: string;
}): OutreachEventKind {
  const channel = event.channel ?? "";
  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  if (isDM) return "dm";
  // The @mention inside a DM is the duplicate of message.im.
  if (isMention && channel.startsWith("D")) return "ignore";
  // Channel: the mention only. message.groups / message.channels are not a second turn.
  if (isMention) return "mention";
  return "ignore";
}
