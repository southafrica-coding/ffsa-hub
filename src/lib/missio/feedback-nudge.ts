import "server-only";
import * as slackClient from "@/lib/slack/client";
import { hubFormsNudgeEnabled } from "@/lib/forms/flags";
import type { SlackApi } from "@/lib/forms/route-slack";
import { joburgDate } from "@/lib/missio/feedback";
import { feedbackSunday, loadWeeklyForm } from "@/lib/missio/weekly-feedback";

// ============================================================
// The 18:00 SAST Sunday nudge (Hub Forms F4) — OFF
// ============================================================
// One private Slack DM to each leader of a house that has not sent
// this week's feedback, like the vehicle digest: a DM, never a
// channel, with an Open button. A house that has sent hears nothing.
//
// Off unless hubFormsNudgeEnabled() (HUB_FORMS_NUDGE_ENABLED and
// HUB_FORMS_SLACK_ENABLED on the live site). Off returns before any
// database read or Slack call.
//
// Once per leader per week: the DM is claimed in
// form_route_slack_messages (391) under period "nudge:<date>" before it
// is sent, so the cron and the results-page button can never both
// send it, and a second press sends nothing new.
//
// The cron (api/cron/missio-feedback-nudge) is NOT in vercel.json.
// Adding it there is a go-live step for Jack.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type NudgeResult = {
  status: "off" | "not_time" | "no_form" | "no_token" | "done";
  /** House numbers that had not sent. */
  missing: number[];
  sent: number;
  /** Already nudged this week, or no Slack account. */
  skipped: number;
};

const OFF = (status: NudgeResult["status"]): NudgeResult => ({ status, missing: [], sent: 0, skipped: 0 });

/** Sunday, 18:00 or later, in Johannesburg. */
export function isNudgeTime(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Sun" && hour >= 18;
}

const site = (env: NodeJS.ProcessEnv) => env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";

export function nudgeMessage(house: { id: string; number: number }, meetingDate: string, env: NodeJS.ProcessEnv) {
  const url = `${site(env)}/missio-feedback/${house.id}`;
  return {
    text: `House ${house.number}: this week's feedback isn't in yet`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📝 Weekly feedback — House ${house.number}*\nThis week's feedback isn't in yet. It takes about five minutes, and your coach and the pastors read every one.`,
        },
      },
      {
        type: "actions",
        elements: [{ type: "button", action_id: "hf_open", text: { type: "plain_text", text: "Open the form" }, url }],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: `Week of ${meetingDate}. Only you see this message.` }] },
    ],
  };
}

type House = { id: string; number: number; meeting_day: string | null };

/**
 * Nudge the leaders of every house that has not sent. `force` skips the
 * Sunday 18:00 check (the pastors' button); it does not skip the flag.
 */
export async function runFeedbackNudge(
  db: Db,
  deps: { env?: NodeJS.ProcessEnv; now?: Date; slack?: SlackApi; force?: boolean } = {}
): Promise<NudgeResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  if (!hubFormsNudgeEnabled(env)) return OFF("off");
  if (!deps.force && !isNudgeTime(now)) return OFF("not_time");
  if (!env.SLACK_BOT_TOKEN) return OFF("no_token");
  const form = await loadWeeklyForm(db);
  if (!form) return OFF("no_form");
  const api = deps.slack ?? slackClient;

  const org = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  const orgId = (org.data as { id: string } | null)?.id;
  if (!orgId) return OFF("no_form");

  const housesRes = await db.from("house_churches").select("id, number, meeting_day").eq("org_id", orgId).order("number");
  const houses = (housesRes.data ?? []) as House[];
  const today = joburgDate(now);
  const weekStart = new Date(`${today}T12:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const sentRes = await db
    .from("missio_house_feedback")
    .select("house_church_id, meeting_date")
    .in("house_church_id", houses.map((h) => h.id))
    .gt("meeting_date", weekStart.toISOString().slice(0, 10));
  const sent = new Set(
    ((sentRes.data ?? []) as { house_church_id: string; meeting_date: string }[]).map((r) => `${r.house_church_id}|${String(r.meeting_date)}`)
  );

  const result: NudgeResult = { status: "done", missing: [], sent: 0, skipped: 0 };
  for (const house of houses) {
    const date = feedbackSunday(house.meeting_day, now);
    if (sent.has(`${house.id}|${date}`)) continue;
    result.missing.push(house.number);

    const leaders = await db
      .from("house_church_members")
      .select("contact_id")
      .eq("house_church_id", house.id)
      .in("role", ["leader", "co_leader"])
      .is("ended_at", null);
    const contactIds = ((leaders.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
    if (contactIds.length === 0) continue;
    const users = await db.from("users").select("id, slack_user_id").in("contact_id", contactIds);
    for (const user of (users.data ?? []) as { id: string; slack_user_id: string | null }[]) {
      if (!user.slack_user_id) {
        result.skipped += 1;
        continue;
      }
      // Claim first: a second run this week finds the claim and sends nothing.
      const claim = await db
        .from("form_route_slack_messages")
        .insert({
          form_id: form.id,
          subject_type: "house",
          subject_id: house.id,
          period_key: `nudge:${date}`,
          recipient_user_id: user.id,
        })
        .select("id")
        .single();
      if (claim.error || !claim.data) {
        result.skipped += 1;
        continue;
      }
      const rowId = (claim.data as { id: string }).id;
      const open = await api.openConversation(user.slack_user_id).catch(() => null);
      const posted =
        open?.ok && open.channel?.id
          ? await api.postMessage({ channel: open.channel.id, ...nudgeMessage(house, date, env) }).catch(() => null)
          : null;
      if (posted?.ok && posted.ts) {
        await db
          .from("form_route_slack_messages")
          .update({ slack_channel: posted.channel ?? open?.channel?.id ?? "", slack_ts: posted.ts })
          .eq("id", rowId);
        result.sent += 1;
      } else {
        // Let a later run try again.
        await db.from("form_route_slack_messages").delete().eq("id", rowId);
        result.skipped += 1;
      }
    }
  }
  return result;
}
