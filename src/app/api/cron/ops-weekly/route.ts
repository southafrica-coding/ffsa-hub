import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWeekly } from "@/lib/operations/slack";

export const maxDuration = 60;

// GET /api/cron/ops-weekly — Vercel cron, Tuesday 15:00 UTC = 17:00 SAST:
// close of work the day before the Wednesday 10:00 operations meeting.
// Posts the week (Wednesday to now) to the ops channel.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendWeekly(createAdminClient())) });
  } catch (err) {
    console.error("[cron/ops-weekly] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
