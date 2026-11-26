import { previewWritesDisabled } from "@/lib/preview-writes";
import { isBotConfigured } from "@/lib/slack/bots";

/**
 * The private "Hub" Slack assistant for ministry leaders stays off until
 * HUB_SLACK_ASSISTANT_ENABLED is "1" or "true", and even then only on the
 * live site. Previews share the production database, so a preview never
 * answers, writes or sends — whatever the flag says.
 *
 * Slack's url_verification handshake is answered regardless, so the app
 * can be set up in Slack before go-live (see the events route).
 */
export const HUB_SLACK_ASSISTANT_ENABLED = "HUB_SLACK_ASSISTANT_ENABLED";

export function hubSlackAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[HUB_SLACK_ASSISTANT_ENABLED];
  if (v !== "1" && v !== "true") return false;
  return env.VERCEL_ENV === "production" && !previewWritesDisabled(env);
}

/** Enabled, and the "Hub" Slack app's keys are set (lib/slack/bots). */
export function hubSlackAssistantLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return hubSlackAssistantEnabled(env) && isBotConfigured("assistant");
}

/** The model key is set. Without it a leader gets a plain "not available". */
export function hubSlackAssistantModelReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}
