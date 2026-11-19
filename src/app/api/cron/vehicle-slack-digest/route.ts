import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { fleetDigestPart, type FleetDigestPart } from "@/lib/fleet/reminder-send";
import { sendVehicleDigest } from "@/lib/vehicles/slack-alerts";

export const maxDuration = 60;

// GET /api/cron/vehicle-slack-digest — daily Vercel cron, 05:00 UTC = 07:00
// SAST. The vehicle coordinator's morning Slack summary: overdue returns,
// today's pickups and returns, unpaid pickups within 2 days, requests waiting
// 2+ days, signed-in bookings not yet marked completed, and Fleet's inspection
// checks (the Fleet reminder is emailed from here too, and is no longer a separate
// Slack message). Quiet days send nothing. (Hobby plan: crons must be once-per-day.)
export async function GET(request: Request) {
  // Refuses when CRON_SECRET is missing, not just when it doesn't match.
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Fleet first, and never at the bookings digest's expense: if it fails, the digest still goes.
  let fleet: FleetDigestPart | null = null;
  try {
    fleet = await fleetDigestPart(createAdminClient());
  } catch (err) {
    console.error("[cron/vehicle-slack-digest] fleet reminder failed", err);
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendVehicleDigest({ fleet })), fleet: fleet?.outcome ?? "failed" });
  } catch (err) {
    console.error("[cron/vehicle-slack-digest] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
