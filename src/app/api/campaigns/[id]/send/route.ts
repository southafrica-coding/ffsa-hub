import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignBatch, sendableThisRun } from "@/services/campaign-send";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";

// One batch may take ~25s of Mailtrap calls — allow headroom.
export const maxDuration = 60;

// POST /api/campaigns/[id]/send — sends ONE throttled batch and reports state.
// The composer loops this for small sends; once the hourly budget is spent it
// returns `throttled: true` and the cron drains the rest over the next hours.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, COMMS_SEND_PERMS))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Throttle: cap this batch to the remaining account-wide hourly budget. When
  // it's spent, don't send — tell the client the rest will drip via the cron.
  const budget = await sendableThisRun(admin);
  if (budget <= 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      remaining: null,
      done: false,
      throttled: true,
    });
  }

  const result = await sendCampaignBatch(admin, id, budget);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
  }
  // `throttled` tells the composer to stop looping and hand off to the cron:
  // either Mailtrap hit the quota mid-batch, or we sent exactly the budget and
  // more recipients remain.
  const throttled = Boolean(result.rateLimited) || (!result.done && result.sent >= budget);
  return NextResponse.json({ ...result, throttled });
}
