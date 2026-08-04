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

// ── Throttle configuration ──────────────────────────────────
// Mailtrap's live bulk stream enforces an hourly sending quota. We stay under
// it by capping how many recipients go out per rolling hour (across ALL
// campaigns, since the quota is account-wide) and per single run. The cron
// runs every few minutes and drains large audiences gradually. Both values are
// env-tunable so the rate can be raised after a Mailtrap plan upgrade without a
// code change.
export const HOURLY_SEND_LIMIT = Number(process.env.MAILTRAP_HOURLY_LIMIT) || 300;
export const PER_RUN_CAP = Number(process.env.CAMPAIGN_SEND_PER_RUN) || 50;

export type BatchResult = {
  ok: boolean;
  error?: string;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  /** Set when the batch stopped early because Mailtrap's hourly quota was hit. */
  rateLimited?: boolean;
};

/**
 * How many recipients may still be sent this run without breaching the hourly
 * quota — the account-wide budget (min of the per-run cap and the remaining
 * hourly allowance). Counts rows actually sent in the trailing 60 minutes, so
 * it self-corrects as sends accumulate. Returns 0 when the hour is spent.
 */
export async function sendableThisRun(
  supabase: Client,
  perRunCap = PER_RUN_CAP
): Promise<number> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .not("sent_at", "is", null)
    .gte("sent_at", since);
  const remainingHour = HOURLY_SEND_LIMIT - (count ?? 0);
  return Math.max(0, Math.min(perRunCap, remainingHour));
}

/**
 * Fetch every row of a PostgREST query, paging past the default 1000-row cap.
 * `build(from, to)` must return a query with `.range(from, to)` applied.
 */
async function fetchAllRows<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null }>
): Promise<T[]> {
  const page = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += page) {
    const { data } = await build(from, from + page - 1);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

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
  // recipients already processed in earlier batches. Both queries are paged
  // past PostgREST's 1000-row cap — without this a 7000-contact audience was
  // silently truncated to the first 1000, so most contacts never got emailed.
  const [audience, doneRows] = await Promise.all([
    fetchAllRows<{ contact_id: string; email: string; first_name: string | null }>(
      (from, to) =>
        supabase
          .from("v_campaign_audience")
          .select("contact_id, email, first_name")
          .eq("campaign_id", campaignId)
          .range(from, to)
    ),
    fetchAllRows<{ contact_id: string }>((from, to) =>
      supabase
        .from("campaign_recipients")
        .select("contact_id")
        .eq("campaign_id", campaignId)
        .range(from, to)
    ),
  ]);

  const done = new Set(doneRows.map((r) => r.contact_id));
  const pending = audience.filter((a) => !done.has(a.contact_id));

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
  let processed = 0;
  let rateLimited = false;

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

    // Hourly quota hit: stop immediately and leave this recipient UNprocessed
    // (no row inserted) so a later run retries them. Recording it would burn
    // the contact — the bug that turned a throttle into 600+ fake "bounces".
    if (result.rateLimited) {
      rateLimited = true;
      break;
    }

    const nowIso = new Date().toISOString();
    processed++;
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

  // Recipients still awaiting a send after this run. Uses `processed` (rather
  // than the batch length) so an early rate-limit stop is reflected correctly.
  const remaining = pending.length - processed;
  // Only flip to "sent" when the whole audience is drained AND we didn't stop
  // on a rate limit — otherwise the cron resumes the remainder on a later run.
  if (remaining === 0 && !rateLimited) {
    await supabase
      .from("campaigns")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  return {
    ok: true,
    sent,
    failed,
    rateLimited,
    remaining,
    done: remaining === 0 && !rateLimited,
  };
}
