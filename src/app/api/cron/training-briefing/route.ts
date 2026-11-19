import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { sendTrainingBriefing } from "@/lib/training/briefing";

export const maxDuration = 60;

// GET /api/cron/training-briefing — weekly Vercel cron, Mondays 05:30 UTC =
// 07:30 SAST. Each person with Training ties (school leaders, program staff,
// anyone walking with a student) gets their week on Slack, the same list as
// their Today in the app (redesign 48b). Muted "training" → nothing. No
// linked Slack → a push when there's something to do.
export async function GET(request: Request) {
  // Refuses when CRON_SECRET is missing, not just when it doesn't match.
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendTrainingBriefing()) });
  } catch (err) {
    console.error("[cron/training-briefing] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
