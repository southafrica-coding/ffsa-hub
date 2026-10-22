import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { isBotConfigured, type SlackBotId } from "@/lib/slack/bots";
import { reminderText } from "@/lib/slack/outreach/card-logic";

export const maxDuration = 60;

// GET /api/cron/outreach-card-reminders — daily Vercel cron (06:00 UTC =
// 08:00 SAST).
//
// Card payments abroad are recorded at an estimate until the bank's
// notification confirms the rand (migration 265). Each morning, everyone
// who logged one that's still waiting gets a Slack DM listing them, so the
// estimates are swapped for the real rand before closeout. Only the person
// who logged it is reminded. Closed-out teams are skipped.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Row = {
  created_by: string;
  vendor: string | null;
  description: string;
  local_amount: number | string;
  local_currency: string;
  expense_date: string;
  team_id: string;
  outreach_teams: { team_name: string };
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin: Client = createAdminClient();
  const [{ data: rows, error }, { data: closed }] = await Promise.all([
    admin
      .from("outreach_expenses")
      .select("created_by, vendor, description, local_amount, local_currency, expense_date, team_id, outreach_teams!inner(team_name)")
      .eq("payment_method", "card")
      .neq("local_currency", "ZAR")
      .eq("zar_confirmed", false)
      .order("expense_date", { ascending: true })
      .range(0, 4999),
    admin.from("outreach_closeouts").select("team_id").in("status", ["auto_closed", "admin_override"]),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const closedTeams = new Set(((closed ?? []) as { team_id: string }[]).map((c) => c.team_id));
  const byPerson = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    if (closedTeams.has(r.team_id)) continue;
    byPerson.set(r.created_by, [...(byPerson.get(r.created_by) ?? []), r]);
  }
  if (!byPerson.size) return NextResponse.json({ ok: true, reminded: 0 });

  const { data: people } = await admin.from("users").select("id, slack_user_id").in("id", [...byPerson.keys()]);
  const slackId = new Map(((people ?? []) as { id: string; slack_user_id: string | null }[]).map((p) => [p.id, p.slack_user_id]));
  const bot: SlackBotId = isBotConfigured("outreach") ? "outreach" : "hub";

  let reminded = 0;
  let unreachable = 0;
  for (const [userId, items] of byPerson) {
    const sid = slackId.get(userId);
    if (!sid) {
      unreachable++;
      continue;
    }
    try {
      const dm = await slack.openConversation(sid, bot);
      const channel = dm.ok ? dm.channel?.id : undefined;
      if (!channel) {
        unreachable++;
        continue;
      }
      await slack.postMessage({
        channel,
        bot,
        text: reminderText(
          items.map((r) => ({
            vendor: r.vendor,
            description: r.description,
            local_amount: Number(r.local_amount),
            local_currency: r.local_currency,
            expense_date: r.expense_date,
            team_name: r.outreach_teams.team_name,
          }))
        ),
      });
      reminded++;
    } catch (err) {
      console.error("[cron/outreach-card-reminders] DM failed", userId, err);
      unreachable++;
    }
  }
  return NextResponse.json({ ok: true, reminded, unreachable });
}
