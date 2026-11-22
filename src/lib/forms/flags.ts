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

const on = (v: string | undefined) => v === "1" || v === "true";

/**
 * The 18:00 SAST Sunday nudge to house leaders who have not sent their
 * weekly feedback (F4, lib/missio/feedback-nudge.ts). Off unless
 * HUB_FORMS_NUDGE_ENABLED is "1" or "true" on the live site. Like the
 * Slack flag, a preview never sends. The nudge is a Slack DM, so it also
 * needs HUB_FORMS_SLACK_ENABLED.
 */
export const HUB_FORMS_NUDGE_ENABLED = "HUB_FORMS_NUDGE_ENABLED";

export function hubFormsNudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env[HUB_FORMS_NUDGE_ENABLED]) && hubFormsSlackEnabled(env);
}

/**
 * Making the 20 house feedback links (F4, lib/missio/feedback-links.ts).
 * The ops script runs from a laptop, not Vercel, so this is only the
 * flag and the preview switch: MISSIO_FEEDBACK_LINKS_ENABLED "1" or "true".
 */
export const MISSIO_FEEDBACK_LINKS_ENABLED = "MISSIO_FEEDBACK_LINKS_ENABLED";

export function missioFeedbackLinksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env[MISSIO_FEEDBACK_LINKS_ENABLED]) && !previewWritesDisabled(env);
}
