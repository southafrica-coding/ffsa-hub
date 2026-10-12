import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignBatch } from "@/services/campaign-send";

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
  }> = [];
  // Each campaign run stops itself at ~40s. Don't start another campaign
  // once a run has eaten into the 60s limit — the next tick picks it up.
  const startedAt = Date.now();
  for (const id of ids) {
    if (results.length > 0 && Date.now() - startedAt > 10_000) break;
    const r = await sendCampaignBatch(admin, id);
    results.push({
      id,
      sent: r.sent,
      failed: r.failed,
      done: r.done,
      rateLimited: r.rateLimited,
    });
    // Resend said "try later" — stop the whole run, resume next time.
    if (r.rateLimited) break;
  }

  return NextResponse.json({ processed: results.length, results });
}
