/**
 * The Hub's Slack bots. Each job gets its own Slack app, so each has its
 * own name in Slack, its own permissions and its own keys:
 *
 *   hub       "FFSA Hub Activity" — notifications, alert buttons and the
 *             staff Q&A. The original app; SLACK_BOT_TOKEN /
 *             SLACK_SIGNING_SECRET.
 *   outreach  "Outreach Finance" — outreach teams' budget questions and
 *             receipts. /api/slack/outreach/*; SLACK_OUTREACH_BOT_TOKEN /
 *             SLACK_OUTREACH_SIGNING_SECRET. Setup:
 *             docs/slack/outreach-finance-manifest.json.
 *   assistant "Hub" — a private, DM-only assistant for ministry leaders:
 *             their team's Hub access, bookings, approvals, contacts,
 *             Hub help and problem reports; every change behind a
 *             button, within the asker's own Hub permissions.
 *             /api/slack/assistant/*; SLACK_ASSISTANT_BOT_TOKEN /
 *             SLACK_ASSISTANT_SIGNING_SECRET. Off unless
 *             HUB_SLACK_ASSISTANT_ENABLED (lib/slack/assistant/hub-leader/
 *             flags). Setup: docs/slack/hub-assistant.md.
 *
 * Slack user ids are per workspace, not per app, so users.slack_user_id
 * links a person for every bot.
 */

export type SlackBotId = "hub" | "outreach" | "assistant";

const ENV: Record<SlackBotId, { token: string; secret: string }> = {
  hub: { token: "SLACK_BOT_TOKEN", secret: "SLACK_SIGNING_SECRET" },
  outreach: { token: "SLACK_OUTREACH_BOT_TOKEN", secret: "SLACK_OUTREACH_SIGNING_SECRET" },
  assistant: { token: "SLACK_ASSISTANT_BOT_TOKEN", secret: "SLACK_ASSISTANT_SIGNING_SECRET" },
};

export const BOT_NAMES: Record<SlackBotId, string> = {
  hub: "FFSA Hub Activity",
  outreach: "Outreach Finance",
  assistant: "Hub",
};

export function botToken(bot: SlackBotId): string | undefined {
  return process.env[ENV[bot].token] || undefined;
}

export function botSigningSecret(bot: SlackBotId): string | undefined {
  return process.env[ENV[bot].secret] || undefined;
}

/** The bot's Slack app is installed and its keys are set. */
export function isBotConfigured(bot: SlackBotId): boolean {
  return Boolean(botToken(bot) && botSigningSecret(bot));
}
