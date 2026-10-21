/**
 * "Running low" alerts: when the money still with an outreach team drops
 * to its low level (default 30% of what was sent) and again at critical
 * (15%), the team's owner and co-leaders get a Slack DM so base can send more
 * in time. See lib/finance/outreach-cash.ts for the maths.
 *
 * Call checkCashAlert(teamId) after anything that changes a team's money:
 * an expense added/edited/removed (Hub, import, Slack receipt) or a
 * payout added/edited/removed. It's cheap, idempotent, and alerts once per
 * level — the stored level only moves when it changes, and the update is
 * conditional so two expenses at once can't both send.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { isBotConfigured, type SlackBotId } from "@/lib/slack/bots";
import { sastDate } from "@/lib/slack/assistant/outreach";
import {
  alertToSend,
  cashInHand,
  daysLeft,
  recentDailySpend,
  spentFromSent,
  type CashExpense,
  type CashLevel,
} from "@/lib/finance/outreach-cash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com";

const zar = (n: number) => `R${Math.round(n).toLocaleString("en-ZA").replace(/[ ,]/g, " ")}`;

export function alertText(args: {
  team: string;
  level: "low" | "critical";
  left: number;
  sent: number;
  pctLeft: number;
  days: number | null;
  teamId: string;
}): string {
  const pct = `${Math.max(0, Math.round(args.pctLeft))}%`;
  const lasts = args.days != null && args.left > 0 ? ` — about ${args.days} day${args.days === 1 ? "" : "s"} at this week's spending` : "";
  const head =
    args.level === "critical"
      ? args.left < 0
        ? `🔴 *${args.team}* has spent ${zar(-args.left)} more than was sent to them.`
        : `🔴 *${args.team}* has only *${zar(args.left)}* left of the ${zar(args.sent)} sent (${pct})${lasts}.`
      : `🟠 *${args.team}* has *${zar(args.left)}* left of the ${zar(args.sent)} sent (${pct})${lasts}.`;
  const ask = args.level === "critical" ? "Please send money now." : "Time to plan the next transfer.";
  return `${head}\n${ask} <${SITE}/finance/outreach/${args.teamId}|Open the team>`;
}

export async function checkCashAlert(teamId: string): Promise<void> {
  try {
    const admin: Admin = createAdminClient();
    const [{ data: team }, { data: releases }, { data: expenses }] = await Promise.all([
      admin
        .from("outreach_teams")
        .select("id, team_name, cash_alert_low_pct, cash_alert_critical_pct, cash_alert_level")
        .eq("id", teamId)
        .maybeSingle(),
      admin.from("outreach_fund_releases").select("amount_zar").eq("team_id", teamId),
      admin.from("outreach_expenses").select("zar_amount, payment_method, expense_date").eq("team_id", teamId).range(0, 9999),
    ]);
    if (!team) return;

    const sent = ((releases ?? []) as { amount_zar: number }[]).reduce((s, r) => s + Number(r.amount_zar), 0);
    const exp = (expenses ?? []) as CashExpense[];
    const c = cashInHand({
      sent,
      spent: spentFromSent(exp),
      lowPct: team.cash_alert_low_pct,
      criticalPct: team.cash_alert_critical_pct,
    });

    const prev = (team.cash_alert_level ?? null) as CashLevel | null;
    const next: CashLevel | null = c.level === "none" ? null : c.level;
    if (prev === next) return;

    const send = alertToSend(prev, c.level);
    // Conditional: only one caller gets to move the level (and send).
    let q = admin
      .from("outreach_teams")
      .update({ cash_alert_level: next, ...(send ? { cash_alert_at: new Date().toISOString() } : {}) })
      .eq("id", teamId);
    q = prev === null ? q.is("cash_alert_level", null) : q.eq("cash_alert_level", prev);
    const { data: moved } = await q.select("id");
    if (!moved?.length || !send) return;

    await notifyLeaders(admin, teamId, alertText({
      team: team.team_name,
      level: send,
      left: c.left,
      sent: c.sent,
      pctLeft: c.pctLeft ?? 0,
      days: daysLeft(c.left, recentDailySpend(exp, sastDate(new Date()))),
      teamId,
    }));
  } catch (err) {
    // Never let an alert break the expense or payout that triggered it.
    console.error("[outreach/cash-alerts] check failed", teamId, err);
  }
}

/** The team's owner and co-leaders, who get alerts, and whether each can be reached. */
export async function alertRecipients(admin: Admin, teamId: string) {
  const { data } = await admin
    .from("outreach_team_members")
    .select("users(id, first_name, last_name, slack_user_id)")
    .eq("team_id", teamId)
    .in("role", ["owner", "co_leader"]);
  return ((data ?? []) as { users: { id: string; first_name: string | null; last_name: string | null; slack_user_id: string | null } | null }[])
    .map((r) => r.users)
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "Unnamed",
      slackUserId: u.slack_user_id,
    }));
}

async function notifyLeaders(admin: Admin, teamId: string, text: string) {
  const bot: SlackBotId = isBotConfigured("outreach") ? "outreach" : "hub";
  const people = await alertRecipients(admin, teamId);
  const reachable = people.filter((p) => p.slackUserId);
  if (!reachable.length) {
    console.warn("[outreach/cash-alerts] no owner or co-leader with Slack linked on team", teamId);
    return;
  }
  await Promise.all(
    reachable.map(async (p) => {
      try {
        const dm = await slack.openConversation(p.slackUserId!, bot);
        const channel = dm.ok ? dm.channel?.id : undefined;
        if (channel) await slack.postMessage({ channel, text, bot });
      } catch (err) {
        console.error("[outreach/cash-alerts] DM failed", p.name, err);
      }
    })
  );
}
