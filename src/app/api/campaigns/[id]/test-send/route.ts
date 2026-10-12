import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCampaignById } from "@/services/campaigns";
import { getEffectiveBrand } from "@/services/brand";
import {
  renderCampaignHtml,
  renderCampaignText,
  type CampaignBody,
} from "@/lib/campaigns/blocks";
import { sendViaResend } from "@/lib/email/resend-send";
import { substituteFirstName, escapeHtml } from "@/lib/email/placeholders";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmail, markSent, markFailed } from "@/lib/email/ledger";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";

// POST /api/campaigns/[id]/test-send
// Body: { to: string }
//
// Renders the campaign through the same renderer used for real sends,
// including the brand kit attached to the campaign's sending identity.
// Subject is unchanged from the real campaign so deliverability mirrors
// production exactly — no [TEST] prefix (it tanks spam scores). A subtle
// preview banner inside the email body indicates it's a preview.
// No campaign_recipients row is written — this never counts toward
// analytics or campaign state.
export async function POST(
  request: Request,
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

  let body: { to?: string };
  try {
    body = (await request.json()) as { to?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = (body.to ?? user.email ?? "").trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json(
      { error: "Provide a valid email address" },
      { status: 400 }
    );
  }

  const { data: campaign, error } = await getCampaignById(supabase, id);
  if (error || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!campaign.sending_identities) {
    return NextResponse.json(
      { error: "Campaign has no sending identity" },
      { status: 400 }
    );
  }
  if (!campaign.subject?.trim()) {
    return NextResponse.json(
      { error: "Add a subject before sending a test" },
      { status: 400 }
    );
  }
  const source = campaign.body_source as unknown as CampaignBody | null;
  if (!source || !source.blocks?.length) {
    return NextResponse.json(
      { error: "Add at least one content block first" },
      { status: 400 }
    );
  }

  const brand = await getEffectiveBrand(supabase, campaign.sending_identity_id);
  const testNotice = `Preview send to ${to}. Recipients won't see this notice. The rest of the email is exactly what would be sent.`;

  // Resolve [First Name] / {{first_name}} tokens the same way a real send
  // does, so the preview is honest. Prefer the test recipient's own contact
  // first name; if the test address isn't a contact, fall back to the
  // sender's own name so the merge field visibly resolves in the preview
  // (instead of the bare "there" a nameless recipient would get); only then
  // "there".
  const { data: testContact } = await supabase
    .from("contacts")
    .select("first_name")
    .ilike("email", to)
    .limit(1)
    .maybeSingle();
  let firstName = (testContact?.first_name as string | null)?.trim() || "";
  if (!firstName) {
    const { data: me } = await supabase
      .from("users")
      .select("first_name")
      .eq("id", user.id)
      .maybeSingle();
    firstName = (me?.first_name as string | null)?.trim() || "there";
  }

  const html = substituteFirstName(
    renderCampaignHtml(source, {
      previewText: campaign.preview_text ?? undefined,
      brand,
      testNotice,
    }),
    escapeHtml(firstName)
  );
  const text = substituteFirstName(
    renderCampaignText(source, { brand, testNotice }),
    firstName
  );
  const subject = substituteFirstName(campaign.subject, firstName);

  const identity = campaign.sending_identities as {
    from_email: string;
    from_name: string;
    reply_to: string | null;
  };

  // Mirror real-send deliverability headers so the test is an honest preview
  // of how Gmail/Yahoo/Outlook will route the actual campaign.
  const domain = identity.from_email.split("@")[1] ?? "ffsahub.com";
  const prefsUrl = `${APP_URL}/preferences?t=test`;
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${prefsUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "List-ID": `campaigns.${domain} <campaign-test-${id}.${domain}>`,
    Precedence: "bulk",
    "X-Entity-Ref-ID": `test:${id}:${Date.now()}`,
  };

  // Log the test in the delivery ledger. It stays out of campaign analytics
  // (no campaign_recipients row), but "the site said it sent and nothing
  // arrived" is undiagnosable without the provider's message id on record.
  const admin = createAdminClient();
  const ledgerId = await recordEmail(admin, {
    toEmail: to,
    provider: "resend",
    category: "campaign_test",
    subject,
    sourceType: "campaign",
    sourceId: id,
    reason: `Test send of "${campaign.name}" requested by ${user.email ?? "a Hub user"}`,
    fromIdentityId: campaign.sending_identity_id ?? null,
  });

  const result = await sendViaResend({
    fromEmail: identity.from_email,
    fromName: identity.from_name,
    replyTo: identity.reply_to,
    to,
    subject,
    html,
    text,
    category: `campaign-test:${id}`,
    headers,
  });

  if (result.error) {
    await markFailed(admin, ledgerId, result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  await markSent(admin, ledgerId, result.messageId);
  return NextResponse.json({ ok: true, messageId: result.messageId, to });
}
