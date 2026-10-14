import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCampaign, setCampaignLabels } from "@/services/campaigns";
import {
  emptyCampaignBody,
  renderCampaignHtml,
  newBlockId,
} from "@/lib/campaigns/blocks";
import { getCampaignTemplate } from "@/lib/campaigns/templates";
import { getEffectiveBrand } from "@/services/brand";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import type { Json } from "@/types/database";

// POST /api/campaigns — create a draft campaign.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    name?: string;
    labelIds?: string[];
    sendingIdentityId?: string;
    templateId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // Labels are optional at creation: the audience can instead be contacts
  // hand-picked in the composer (migration 234). Sending still needs one.
  if (body.labelIds !== undefined && !Array.isArray(body.labelIds)) {
    return NextResponse.json({ error: "labelIds must be a list" }, { status: 400 });
  }
  if (!body.sendingIdentityId) {
    return NextResponse.json(
      { error: "sendingIdentityId is required" },
      { status: 400 }
    );
  }

  // Pick the template body if requested, otherwise the empty starter.
  const template = body.templateId
    ? getCampaignTemplate(body.templateId)
    : undefined;
  if (body.templateId && !template) {
    return NextResponse.json(
      { error: "Unknown templateId" },
      { status: 400 }
    );
  }
  const initialBody = template ? template.build(newBlockId) : emptyCampaignBody();
  const brand = await getEffectiveBrand(supabase, body.sendingIdentityId);
  const { data, error } = await createCampaign(supabase, {
    name: body.name.trim(),
    subject: "",
    body_source: initialBody as unknown as Json,
    body_html: renderCampaignHtml(initialBody, { brand }),
    sending_identity_id: body.sendingIdentityId,
    status: "draft",
    created_by: user.id,
  });

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create campaign" },
      { status: 500 }
    );
  }

  const setRes = await setCampaignLabels(supabase, data.id, body.labelIds ?? []);
  if (setRes.error) {
    return NextResponse.json({ error: setRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: data });
}
