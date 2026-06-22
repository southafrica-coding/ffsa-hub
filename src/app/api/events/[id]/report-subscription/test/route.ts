/**
 * POST /api/events/[id]/report-subscription/test
 *
 * "Send test now" — builds the digest for the caller's saved subscription
 * and delivers it immediately on the enabled channel(s). Does NOT touch
 * last_sent_at / the idempotency window, so a test never suppresses the
 * next scheduled send. Returns per-channel outcomes so the UI can show
 * WhatsApp "pending setup" gracefully.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canAccessEventReports } from "@/lib/api-auth";
import { buildEventTicketReport } from "@/lib/reports/event-ticket-report";
import { sendEventReport } from "@/lib/reports/dispatch";

export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canAccessEventReports(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: sub } = await supabase
    .from("event_report_subscriptions")
    .select(
      "email_enabled, whatsapp_enabled, cadence, dest_email, dest_whatsapp"
    )
    .eq("event_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub) {
    return NextResponse.json(
      { error: "Save your report preferences before sending a test." },
      { status: 400 }
    );
  }

  const cadence = sub.cadence === "weekly" ? "weekly" : "daily";

  let report;
  try {
    report = await buildEventTicketReport(id, cadence);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const outcome = await sendEventReport(report, {
    email_enabled: Boolean(sub.email_enabled),
    whatsapp_enabled: Boolean(sub.whatsapp_enabled),
    dest_email: sub.dest_email,
    dest_whatsapp: sub.dest_whatsapp,
  });

  return NextResponse.json({
    ok: true,
    email: outcome.email,
    whatsapp: outcome.whatsapp,
  });
}
