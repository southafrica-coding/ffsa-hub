import { NextResponse } from "next/server";
import { hubFormsNudgeEnabled } from "@/lib/forms/flags";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { feedbackAdmin } from "@/lib/missio/feedback";
import { runFeedbackNudge } from "@/lib/missio/feedback-nudge";
import { missioRateLimit } from "@/lib/missio/limit";

// POST /api/missio/feedback/nudge — the "Send nudge" button on Sunday
// results. Pastors only. OFF unless HUB_FORMS_NUDGE_ENABLED (flags.ts):
// off answers { status: "off" } and touches nothing.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function POST() {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  if (!hubFormsNudgeEnabled()) return json({ status: "off", sent: 0 });
  const limited = await missioRateLimit(auth.user.id, "house-church-write");
  if (limited) return limited;
  const result = await runFeedbackNudge(feedbackAdmin(), { force: true });
  return json({ status: result.status, sent: result.sent, missing: result.missing });
}
