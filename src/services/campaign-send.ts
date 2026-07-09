import {
  renderCampaignHtml,
  renderCampaignText,
  type CampaignBody,
} from "@/lib/campaigns/blocks";
import { sendViaMailtrap } from "@/lib/email/mailtrap";
import { substituteFirstName, escapeHtml } from "@/lib/email/placeholders";
import { signPrefsToken } from "@/lib/tokens/unsubscribe";
import { getEffectiveBrand } from "@/services/brand";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";

export type BatchResult = {
  ok: boolean;
  error?: string;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
};

function prefsUrlFor(contactId: string, campaignId: string): string {
  const token = signPrefsToken(contactId, campaignId);
  return `${APP_URL}/preferences?t=${encodeURIComponent(token)}`;
}

function footerHtml(prefsUrl: string): string {
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding:18px 36px;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center;">
<a href="${prefsUrl}" style="color:#94a3b8;text-decoration:underline;">Manage email preferences</a>
&middot; Fire &amp; Fragrance South Africa
</td></tr></table>`;
}

/**
 * Build the deliverability headers Gmail, Yahoo, and Microsoft reward.
 * - List-Unsubscribe + List-Unsubscribe-Post: RFC 8058 one-click unsubscribe.
 *   Required by Gmail / Yahoo for senders over ~5K emails/day as of 2024,
 *   and a strong inbox-placement signal at any volume.
 * - List-ID: groups campaigns under a logical list (per campaign here).
 * - Precedence: bulk: signals this is mass mail (filters score it correctly).
 * - X-Entity-Ref-ID: unique per-send identifier so threads don't collapse.
 */
function deliverabilityHeaders(args: {
  prefsUrl: string;
  campaignId: string;
  fromEmail: string;
  contactId: string;
}): Record<string, string> {
  const domain = args.fromEmail.split("@")[1] ?? "ffsahub.com";
  return {
    "List-Unsubscribe": `<${args.prefsUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "List-ID": `campaigns.${domain} <campaign-${args.campaignId}.${domain}>`,
    Precedence: "bulk",
    "X-Entity-Ref-ID": `${args.campaignId}:${args.contactId}`,
  };
}

/**
 * Send one batch of a campaign. Idempotent + resumable: a contact who
 * already has a campaign_recipients row is skipped, so calling this
 * repeatedly drains the audience. Flips status sending → sent when done.
 *
 * Always called with a service-role admin client.
 */
export async function sendCampaignBatch(
  supabase: Client,
  campaignId: string,
  batchSize = 100
): Promise<BatchResult> {
  const base: BatchResult = {
    ok: true,
    sent: 0,
    failed: 0,
    remaining: 0,
    done: false,
  };

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "*, sending_identities(from_email, from_name, reply_to), campaign_labels(label_id)"
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr || !campaign) return { ...base, ok: false, error: "Campaign not found" };

  if (campaign.status === "sent") return { ...base, done: true };
  if (campaign.status === "cancelled" || campaign.status === "failed") {
    return { ...base, ok: false, error: `Campaign is ${campaign.status}` };
  }
  if (!campaign.subject?.trim()) {
    return { ...base, ok: false, error: "Campaign has no subject" };
  }
  if (!campaign.sending_identities) {
    return { ...base, ok: false, error: "Campaign is missing sender" };
  }
  const labelCount = (campaign.campaign_labels ?? []).length;
  if (labelCount === 0) {
    return { ...base, ok: false, error: "Campaign has no audience labels" };
  }

  if (campaign.status !== "sending") {
    await supabase.from("campaigns").update({ status: "sending" }).eq("id", campaignId);
  }

  // Audience for this campaign (DISTINCT across all its labels), minus
  // recipients already processed in earlier batches.
  const [{ data: audience }, { data: doneRows }] = await Promise.all([
    supabase
      .from("v_campaign_audience")
      .select("contact_id, email, first_name")
      .eq("campaign_id", campaignId),
    supabase
      .from("campaign_recipients")
      .select("contact_id")
      .eq("campaign_id", campaignId),
  ]);

  const done = new Set((doneRows ?? []).map((r: { contact_id: string }) => r.contact_id));
  const pending = (audience ?? []).filter(
    (a: { contact_id: string }) => !done.has(a.contact_id)
  );

  if (pending.length === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", campaignId);
    return { ...base, done: true };
  }

  const batch = pending.slice(0, batchSize);
  const body = campaign.body_source as unknown as CampaignBody;
  const fromEmail = campaign.sending_identities.from_email;
  const fromName = campaign.sending_identities.from_name;
  const replyTo = campaign.sending_identities.reply_to;
  const brand = await getEffectiveBrand(supabase, campaign.sending_identity_id);

  let sent = 0;
  let failed = 0;

  for (const recipient of batch as {
    contact_id: string;
    email: string;
    first_name: string | null;
  }[]) {
    const prefsUrl = prefsUrlFor(recipient.contact_id, campaignId);
    // Personalise [First Name] / {{first_name}} tokens the user dropped into
    // any block or the subject. Fall back to "there" when a contact has no
    // first name. The name is HTML-escaped before it lands in HTML so an odd
    // name can't break the markup (mirrors the workflow email path).
    const firstName = recipient.first_name?.trim() || "there";
    const html = substituteFirstName(
      renderCampaignHtml(body, {
        previewText: campaign.preview_text ?? undefined,
        brand,
        footerHtml: footerHtml(prefsUrl),
      }),
      escapeHtml(firstName)
    );
    const text = substituteFirstName(
      renderCampaignText(body, { brand }),
      firstName
    );
    const subject = substituteFirstName(campaign.subject, firstName);

    const result = await sendViaMailtrap({
      fromEmail,
      fromName,
      replyTo,
      to: recipient.email,
      subject,
      html,
      text: `${text}\n\n———\nManage email preferences: ${prefsUrl}`,
      category: `campaign:${campaignId}`,
      headers: deliverabilityHeaders({
        prefsUrl,
        campaignId,
        fromEmail,
        contactId: recipient.contact_id,
      }),
    });

    const nowIso = new Date().toISOString();
    if (result.error) {
      failed++;
      await supabase.from("campaign_recipients").insert({
        campaign_id: campaignId,
        contact_id: recipient.contact_id,
        bounce_reason: result.error.slice(0, 300),
      });
    } else {
      sent++;
      await supabase.from("campaign_recipients").insert({
        campaign_id: campaignId,
        contact_id: recipient.contact_id,
        provider_message_id: result.messageId,
        sent_at: nowIso,
      });
      await supabase.from("activity_events").insert({
        contact_id: recipient.contact_id,
        event_type: "email_sent",
        related_campaign_id: campaignId,
        occurred_at: nowIso,
      });
    }
  }

  const remaining = pending.length - batch.length;
  if (remaining === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  return {
    ok: true,
    sent,
    failed,
    remaining,
    done: remaining === 0,
  };
}
