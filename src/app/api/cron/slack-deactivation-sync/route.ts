import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { handleSlackDeactivation, notifyAdmins } from "@/lib/slack/deactivation";

export const maxDuration = 60;

// GET /api/cron/slack-deactivation-sync — daily Vercel cron (03:00 UTC).
//
// Backstop for /api/slack/events user_change: walks the Slack member list
// (users.list, deactivated members included) and switches off any still-
// active HUB account linked to a deactivated Slack member. Same rules as
// the event path — see lib/slack/deactivation.ts.
//
// ?dry=1 lists who would be affected without changing anything.
//
// Safety brake: if more than BULK_LIMIT people would be switched off in one
// run, nobody is — the list goes to the activity channel for an admin to
// review instead. Guards the first run (people deactivated in Slack before
// this existed) and any Slack-side glitch that reports members as deleted.

const BULK_LIMIT = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN not set" }, { status: 500 });
  }

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  const admin: Client = createAdminClient();

  // 1. Every deactivated Slack member, a page of 200 at a time.
  const deactivated = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await slack.listUsers(cursor);
    if (!res.ok) {
      return NextResponse.json(
        { error: `users.list failed: ${res.error}` },
        { status: 502 }
      );
    }
    for (const m of res.members ?? []) {
      if (m.deleted && !m.is_bot) deactivated.add(m.id);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    pages += 1;
  } while (cursor && pages < 50);

  if (deactivated.size === 0) {
    return NextResponse.json({ checked: 0, results: [] });
  }

  // 2. Active HUB accounts linked to one of them.
  const { data: linked, error } = await admin
    .from("users")
    .select("id, first_name, last_name, slack_user_id")
    .eq("is_active", true)
    .in("slack_user_id", [...deactivated]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldProcess: (linked ?? []).map(
        (u: { first_name: string | null; last_name: string | null; slack_user_id: string }) => ({
          name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
          slack_user_id: u.slack_user_id,
        })
      ),
    });
  }

  const names = (linked ?? []).map(
    (u: { first_name: string | null; last_name: string | null }) =>
      `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Unnamed"
  );
  if (names.length > BULK_LIMIT) {
    await notifyAdmins(
      `:raised_hand: The daily Slack check found *${names.length}* people who are deactivated in Slack but still active in the HUB. That's more than ${BULK_LIMIT} at once, so nobody was switched off automatically. Please review and deactivate them from Users if that's right:\n• ${names.join("\n• ")}`
    );
    return NextResponse.json({ braked: true, count: names.length, names });
  }

  const results = [];
  for (const u of (linked ?? []) as Array<{ slack_user_id: string }>) {
    try {
      const r = await handleSlackDeactivation(admin, u.slack_user_id, "daily_sync");
      results.push({ name: r.name, outcome: r.outcome });
    } catch (err) {
      results.push({
        slack_user_id: u.slack_user_id,
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ checked: linked?.length ?? 0, results });
}
