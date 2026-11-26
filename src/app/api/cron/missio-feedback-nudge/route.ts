import { NextResponse } from "next/server";
import { hubFormsNudgeEnabled } from "@/lib/forms/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeedbackNudge } from "@/lib/missio/feedback-nudge";

export const maxDuration = 60;

// GET /api/cron/missio-feedback-nudge — Sunday 18:00 SAST (16:00 UTC).
//
// NOT SCHEDULED. This path is deliberately not in vercel.json: adding
// { "path": "/api/cron/missio-feedback-nudge", "schedule": "0 16 * * 0" }
// is a go-live step, after Jack OKs it. Even when called it does nothing
// unless HUB_FORMS_NUDGE_ENABLED and HUB_FORMS_SLACK_ENABLED are on and
// this is the live site (flags.ts), and it only sends from Sunday 18:00.

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hubFormsNudgeEnabled()) return NextResponse.json({ status: "off" });
  const result = await runFeedbackNudge(createAdminClient());
  return NextResponse.json({ status: result.status, sent: result.sent, skipped: result.skipped, missing: result.missing });
}
