import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCampaignById, getCampaignStats } from "@/services/campaigns";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/campaigns/[id]/stats — live delivery counters for one campaign.
// The send dialog polls this after a send so "it went out" can be followed by
// "and the provider says it arrived", which only webhooks can tell us.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, COMMS_SEND_PERMS))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: campaign, error } = await getCampaignById(supabase, id);
  if (error || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const stats = await getCampaignStats(supabase, id);
  // Live counters: never cache, or a poll can be handed an earlier "0".
  return NextResponse.json(
    { ...stats, status: campaign.status },
    { headers: { "Cache-Control": "no-store" } }
  );
}
