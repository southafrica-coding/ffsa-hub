import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaignById,
  createCampaign,
  getCampaignLabelIds,
  setCampaignLabels,
  setCampaignContacts,
  getCampaignContactIds,
} from "@/services/campaigns";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import type { Json, TablesInsert } from "@/types/database";

// POST /api/campaigns/[id]/duplicate — clone an email into a fresh draft.
// Powers "Duplicate & resend": the copy keeps the design, subject, preview,
// sender, and audience labels, but starts as an editable `draft` so the user
// can tweak it and/or add more audience labels before sending again. Because
// it's a new campaigns row, the send pipeline creates fresh recipient rows and
// re-sends to the full (current) audience, still excluding unsubscribes and
// suppressions via v_campaign_audience.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const source = await getCampaignById(supabase, id);
  if (source.error)
    return NextResponse.json({ error: source.error.message }, { status: 500 });
  if (!source.data)
    return NextResponse.json({ error: "Email not found" }, { status: 404 });

  const src = source.data;
  // `resent_from_id` is added in migration 133; cast until types are regenerated.
  const insert = {
    name: `${src.name} (copy)`,
    subject: src.subject ?? "",
    preview_text: src.preview_text ?? null,
    body_source: (src.body_source ?? null) as unknown as Json,
    body_html: src.body_html ?? "",
    sending_identity_id: src.sending_identity_id,
    status: "draft",
    resent_from_id: src.id,
    created_by: user.id,
  } as unknown as TablesInsert<"campaigns">;
  const { data, error } = await createCampaign(supabase, insert);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to duplicate email" },
      { status: 500 }
    );
  }

  // Carry over the audience labels so a straight resend needs no re-setup.
  const labelIds = await getCampaignLabelIds(supabase, id);
  if (labelIds.length > 0) {
    const setRes = await setCampaignLabels(supabase, data.id, labelIds);
    if (setRes.error) {
      return NextResponse.json({ error: setRes.error.message }, { status: 500 });
    }
  }

  // …and the hand-picked contacts (migration 234).
  const contactIds = await getCampaignContactIds(supabase, id);
  if (contactIds.length > 0) {
    const setRes = await setCampaignContacts(supabase, data.id, contactIds, user.id);
    if (setRes.error) {
      return NextResponse.json({ error: setRes.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ campaign: data });
}
