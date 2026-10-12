import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignBatch } from "@/services/campaign-send";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";

// node:dns is used by the sending-domain re-check inside sendCampaignBatch.
export const runtime = "nodejs";

// One run sends up to ~2,000 recipients in 100-email Resend batches and stops
// itself at ~40s, inside this limit.
export const maxDuration = 60;

// POST /api/campaigns/[id]/send — sends one run of batches and reports state.
// The composer loops this until `done`. `throttled: true` means Resend said
// "try later" (plan quota or rate limit); the cron resumes the rest.
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

  const result = await sendCampaignBatch(admin, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
  }
  // `throttled` tells the composer to stop looping and hand off to the cron.
  return NextResponse.json({ ...result, throttled: Boolean(result.rateLimited) });
}
