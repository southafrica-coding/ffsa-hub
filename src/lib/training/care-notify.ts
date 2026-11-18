// ────────────────────────────────────────────────────────────
// "Needs care" on a check-in (48d): tell the school's leaders and everyone
// walking with the student, except whoever raised it. Slack DM (first names
// only, never note text) plus a push with fixed wording. Anyone who muted
// the "training" module on their profile gets neither on Slack.
// Never throws: a failed notice must not fail the save.
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { sendPush } from "@/lib/push/send";
import { firstName, type NameRow } from "@/lib/mobile/training";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type CareNoticeResult = { recipients: number; slack: number; push: boolean };

export function careSlackText(author: string, student: string): string {
  return `*${author}* flagged *${student}* on a check-in: *needs care*.\nOpen the Training tab in FFSA Hub to see it and take it.`;
}

export async function notifyNeedsCare(
  args: { checkinId: string; enrollmentId: string; authorId: string; today: string },
  deps: { admin?: Client; push?: typeof sendPush; slackClient?: typeof slack } = {}
): Promise<CareNoticeResult> {
  const result: CareNoticeResult = { recipients: 0, slack: 0, push: false };
  try {
    const admin = deps.admin ?? (createAdminClient() as Client);
    const push = deps.push ?? sendPush;
    const sl = deps.slackClient ?? slack;

    const { data: enrolment } = await admin
      .from("enrollments")
      .select("id, user_id, program_id")
      .eq("id", args.enrollmentId)
      .maybeSingle();
    if (!enrolment) return result;

    const [leaders, walkers] = await Promise.all([
      admin.from("program_leaders").select("user_id").eq("program_id", enrolment.program_id),
      admin
        .from("enrollment_staff")
        .select("user_id")
        .eq("enrollment_id", args.enrollmentId)
        .or(`ends_on.is.null,ends_on.gt.${args.today}`),
    ]);
    const recipients = [
      ...new Set([...(leaders.data ?? []), ...(walkers.data ?? [])].map((r: { user_id: string }) => r.user_id)),
    ].filter((id) => id && id !== args.authorId && id !== enrolment.user_id);
    result.recipients = recipients.length;
    if (recipients.length === 0) return result;

    const [people, prefs] = await Promise.all([
      admin
        .from("users")
        .select("id, first_name, last_name, preferred_name, slack_user_id")
        .in("id", [...recipients, args.authorId, enrolment.user_id]),
      admin.from("notification_preferences").select("user_id, muted_modules").in("user_id", recipients),
    ]);
    const byId = new Map<string, NameRow & { slack_user_id?: string | null }>(
      (people.data ?? []).map((p: NameRow & { slack_user_id?: string | null }) => [p.id, p])
    );
    const muted = new Set(
      (prefs.data ?? [])
        .filter((p: { muted_modules?: string[] | null }) => (p.muted_modules ?? []).includes("training"))
        .map((p: { user_id: string }) => p.user_id)
    );
    const listening = recipients.filter((id) => !muted.has(id));

    if (process.env.SLACK_BOT_TOKEN) {
      const text = careSlackText(firstName(byId.get(args.authorId)), firstName(byId.get(enrolment.user_id)));
      for (const id of listening) {
        const slackId = byId.get(id)?.slack_user_id;
        if (!slackId) continue;
        try {
          const open = await sl.openConversation(slackId);
          if (open.ok && open.channel?.id) {
            const posted = await sl.postMessage({ channel: open.channel.id, text });
            if (posted.ok) result.slack += 1;
          }
        } catch (err) {
          console.error("[training/care] slack failed", err);
        }
      }
    }

    const pushed = await push(listening, {
      kind: "training_needs_care",
      key: `training-care:${args.checkinId}`,
      href: "/schools",
    });
    result.push = !("skipped" in pushed && pushed.skipped);
  } catch (err) {
    console.error("[training/care] notice failed", err);
  }
  return result;
}
