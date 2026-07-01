/**
 * Kick off a new intake conversation: open the DM, create the session,
 * and send the opener. Called by the /report-issue slash command and
 * the "Report an issue" global shortcut.
 */

import * as slack from "@/lib/slack/client";
import * as store from "./store";
import { OPENER } from "./conversation";

export async function startIntake(slackUserId: string): Promise<boolean> {
  const conv = await slack.openConversation(slackUserId);
  const dm = conv.ok ? conv.channel?.id : undefined;
  if (!dm) {
    console.error("[hub-feedback/intake] could not open DM", conv.error);
    return false;
  }

  const session = await store.startSession({ slackUserId, dmChannelId: dm });
  if (!session) return false;

  await slack.postMessage({ channel: dm, text: OPENER });
  await store.updateSession(session.id, {
    transcript: [{ role: "bot", text: OPENER, ts: new Date().toISOString() }],
  });
  return true;
}
