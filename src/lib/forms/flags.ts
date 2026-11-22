import { previewWritesDisabled } from "@/lib/preview-writes";

/**
 * Slack DMs from form routes (the `slack` route action) stay off until
 * HUB_FORMS_SLACK_ENABLED is "1" or "true", and even then only on the live
 * site. The route runner (route-slack.ts) checks this before any Slack
 * call or tracking read, so a preview or a flag left off sends nothing.
 */
export const HUB_FORMS_SLACK_ENABLED = "HUB_FORMS_SLACK_ENABLED";

export function hubFormsSlackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[HUB_FORMS_SLACK_ENABLED];
  if (v !== "1" && v !== "true") return false;
  return env.VERCEL_ENV === "production" && !previewWritesDisabled(env);
}
