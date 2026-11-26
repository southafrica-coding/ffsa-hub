import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMorning } from "@/lib/operations/slack";

export const maxDuration = 60;

// GET /api/cron/ops-morning — Vercel cron, Mon–Fri 05:00 UTC = 07:00 SAST.
// Picks up new posts from the Slack maintenance form, sends each area's
// morning message to its channel, then personal reminders (due tomorrow /
// today / yesterday). Quiet areas send nothing.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendMorning(createAdminClient())) });
  } catch (err) {
    console.error("[cron/ops-morning] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
