import { NextResponse } from "next/server";
import { sendVehicleDigest } from "@/lib/vehicles/slack-alerts";

export const maxDuration = 60;

// GET /api/cron/vehicle-slack-digest — daily Vercel cron, 05:00 UTC = 07:00
// SAST. The vehicle coordinator's morning Slack summary: overdue returns,
// today's pickups and returns, unpaid pickups within 2 days, requests waiting
// 2+ days, and signed-in bookings not yet marked completed. Quiet days send
// nothing. (Hobby plan: crons must be once-per-day.)
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendVehicleDigest()) });
  } catch (err) {
    console.error("[cron/vehicle-slack-digest] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
