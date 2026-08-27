import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignBatch, sendableThisRun } from "@/services/campaign-send";

// node:dns is used by the sending-domain re-check inside sendCampaignBatch.
export const runtime = "nodejs";


export const maxDuration = 60;

// GET /api/cron/send-scheduled — runs on a Vercel cron schedule.
// Sends one batch for every campaign that is due (status 'scheduled'
// with scheduled_at in the past) or already 'sending' (resume). Large
// campaigns drain over successive cron runs.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const [{ data: due }, { data: inProgress }] = await Promise.all([
    admin
      .from("campaigns")
      .select("id")
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso),
    admin.from("campaigns").select("id").eq("status", "sending"),
  ]);

  const ids = Array.from(
    new Set([
      ...(due ?? []).map((c: { id: string }) => c.id),
      ...(inProgress ?? []).map((c: { id: string }) => c.id),
    ])
  );

  const results: Array<{
    id: string;
    sent: number;
    failed: number;
    done: boolean;
    rateLimited?: boolean;
    skipped?: string;
  }> = [];
  for (const id of ids) {
    // Throttle: only send as many as the account-wide hourly quota allows this
    // run. When the hour's budget is spent, stop — the next cron run resumes.
    const budget = await sendableThisRun(admin);
    if (budget <= 0) {
      results.push({ id, sent: 0, failed: 0, done: false, skipped: "hourly-limit" });
      break;
    }
    const r = await sendCampaignBatch(admin, id, budget);
    results.push({
      id,
      sent: r.sent,
      failed: r.failed,
      done: r.done,
      rateLimited: r.rateLimited,
    });
    // Mailtrap said the quota is spent — stop the whole run, resume next time.
    if (r.rateLimited) break;
  }

  return NextResponse.json({ processed: results.length, results });
}
