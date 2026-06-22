/**
 * GET /api/cron/event-reports
 *
 * Hourly Vercel cron. Delivers the per-event ticketing-analytics digests
 * that organisers subscribe to in the event "Reports" tab.
 *
 * Each run handles the subscriptions whose send_hour_utc matches the current
 * UTC hour:
 *   • daily  → every day at that hour.
 *   • weekly → only when weekly_weekday matches today's UTC weekday.
 * An idempotency guard on last_window_end makes a double-trigger within the
 * same UTC day a no-op, and each subscription is isolated in its own
 * try/catch so one failure never aborts the batch.
 *
 * Auth: same `Authorization: Bearer ${CRON_SECRET}` pattern as the other
 * cron routes. Runs hourly so arbitrary send hours are honoured — configured
 * in vercel.json.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEventTicketReport } from "@/lib/reports/event-ticket-report";
import {
  sendEventReport,
  overallStatus,
  type ChannelOutcome,
} from "@/lib/reports/dispatch";

export const maxDuration = 60;

type DueRow = {
  id: string;
  event_id: string;
  cadence: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  dest_email: string | null;
  dest_whatsapp: string | null;
  weekly_weekday: number;
  last_window_end: string | null;
};

function firstError(o: {
  email: ChannelOutcome;
  whatsapp: ChannelOutcome;
}): string | null {
  if (o.email.status === "error") return `email: ${o.email.detail}`;
  if (o.whatsapp.status === "error") return `whatsapp: ${o.whatsapp.detail}`;
  return null;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentWeekday = now.getUTCDay();
  const todayMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );

  const { data: rows, error } = await admin
    .from("event_report_subscriptions")
    .select(
      "id, event_id, cadence, email_enabled, whatsapp_enabled, dest_email, dest_whatsapp, weekly_weekday, last_window_end"
    )
    .eq("enabled", true)
    .eq("send_hour_utc", currentHour);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidates = (rows ?? []) as DueRow[];
  const counts = { processed: 0, sent: 0, partial: 0, failed: 0, skipped: 0 };

  for (const row of candidates) {
    // Cadence gate
    if (row.cadence === "weekly" && row.weekly_weekday !== currentWeekday) {
      continue;
    }
    // Idempotency: already sent for the window ending at today's UTC midnight?
    if (row.last_window_end && new Date(row.last_window_end) >= todayMidnight) {
      continue;
    }
    // A subscription with no channel enabled has nothing to do.
    if (!row.email_enabled && !row.whatsapp_enabled) {
      continue;
    }

    counts.processed += 1;
    const cadence = row.cadence === "weekly" ? "weekly" : "daily";

    try {
      const report = await buildEventTicketReport(row.event_id, cadence, now);
      const outcome = await sendEventReport(report, {
        email_enabled: row.email_enabled,
        whatsapp_enabled: row.whatsapp_enabled,
        dest_email: row.dest_email,
        dest_whatsapp: row.dest_whatsapp,
      });
      const status = overallStatus(outcome);
      counts[status] += 1;

      await admin
        .from("event_report_subscriptions")
        .update({
          last_sent_at: now.toISOString(),
          last_window_start: report.windowStart,
          last_window_end: report.windowEnd,
          last_status: status,
          last_error: firstError(outcome),
        })
        .eq("id", row.id);
    } catch (err) {
      counts.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[event-reports] subscription failed", row.id, message);
      await admin
        .from("event_report_subscriptions")
        .update({
          last_sent_at: now.toISOString(),
          last_window_end: todayMidnight.toISOString(),
          last_status: "failed",
          last_error: message.slice(0, 500),
        })
        .eq("id", row.id);
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    hour_utc: currentHour,
    weekday_utc: currentWeekday,
    candidates: candidates.length,
    ...counts,
  });
}
