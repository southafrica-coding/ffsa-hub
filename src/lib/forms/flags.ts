import { previewWritesDisabled } from "@/lib/preview-writes";

/**
 * Slack DMs from form routes (the `slack` route action) stay off until
 * HUB_FORMS_SLACK_ENABLED is "1" or "true", and even then only on the live
 * site. Nothing sends yet: the route runner is F3. The flag is named now so
 * F3 cannot ship switched on.
 */
export const HUB_FORMS_SLACK_ENABLED = "HUB_FORMS_SLACK_ENABLED";

export function hubFormsSlackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[HUB_FORMS_SLACK_ENABLED];
  if (v !== "1" && v !== "true") return false;
  return env.VERCEL_ENV === "production" && !previewWritesDisabled(env);
}
