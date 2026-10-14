import {
  renderCampaignHtml,
  renderCampaignText,
  type CampaignBody,
} from "@/lib/campaigns/blocks";
import { createHash } from "node:crypto";
import { sendBatchViaResend } from "@/lib/email/resend-send";
import { substituteFirstName, escapeHtml } from "@/lib/email/placeholders";
import { sendingBlockedReason, checkDomain } from "@/lib/email/dns-checks";
import { signPrefsToken } from "@/lib/tokens/unsubscribe";
import { getEffectiveBrand } from "@/services/brand";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";

// ── Send pacing ─────────────────────────────────────────────
// Resend has no hourly quota, so a campaign goes out as fast as the batch
// endpoint allows: 100 recipients per request. One run (a composer call or a
// cron tick) sends up to MAX_PER_RUN, stopping early when it nears the
// function's time limit; the composer keeps calling until the audience is
// drained, and the cron resumes anything left over.
const RESEND_BATCH_SIZE = 100;
// Deliberately not read from CAMPAIGN_SEND_PER_RUN: prod may still carry the old
// Mailtrap-era value (50), which would quietly re-impose the drip.
export const MAX_PER_RUN = 2000;
const RUN_TIME_BUDGET_MS = 40_000;

export type BatchResult = {
  ok: boolean;
  error?: string;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  /** Set when the run stopped early because Resend said "try again later". */
  rateLimited?: boolean;
};

type LedgerMirror = {
  legacyId: string;
  toEmail: string;
  contactId: string;
  campaignId: string;
  campaignName: string;
  subject: string;
  identityId: string | null;
  status: "sent" | "failed";
  providerMessageId?: string | null;
  error?: string | null;
  sentAt: string | null;
};

/**
 * Mirror a campaign send into email_messages (migration 185).
 *
 * campaign_recipients remains the campaign sender's own book — v_campaign_stats
 * reads it and the resume logic keys off it — but the unified ledger is what
 * the person log (frame 29d) reads. Without this, every campaign sent after
 * 185's backfill would be missing from her history, which is precisely the
 * fragmentation 185 set out to end.
 *
 * legacy_table/legacy_id carry the campaign_recipients row id, so re-running
 * 185's backfill inserts nothing for rows already mirrored here.
 *
 * Best-effort, like the rest of the ledger: a logging failure must never break
 * or duplicate an actual send.
 */
async function mirrorToLedger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: LedgerMirror[]
) {
  if (rows.length === 0) return;
  try {
    await supabase.from("email_messages").insert(
      rows.map((m) => ({
        to_email: m.toEmail,
        contact_id: m.contactId,
        provider: "resend",
        provider_message_id: m.providerMessageId ?? null,
        category: "campaign",
        subject: m.subject,
        source_type: "campaign",
        source_id: m.campaignId,
        status: m.status,
        error: m.error ?? null,
        sent_at: m.sentAt,
        from_identity_id: m.identityId,
        // Plain words, naming the campaign — still legible on her record a
        // year from now, when the campaign itself may be long deleted.
        reason: `Campaign: ${m.campaignName}`,
        legacy_table: "campaign_recipients",
        legacy_id: m.legacyId,
      }))
    );
  } catch {
    // Deliberately silent: see the doc comment.
  }
}

/**
 * Fetch every row of a PostgREST query, paging past the default 1000-row cap.
 * `build(from, to)` must return a query with `.range(from, to)` applied AND a
 * stable `.order(<unique column>)` — without a deterministic order the page
 * boundaries drift between requests and rows are silently skipped or duplicated
 * (this once skipped ~1,452 recipients of a 7,000-person send).
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
  maxRecipients = MAX_PER_RUN
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
      "*, sending_identities(from_email, from_name, reply_to, sending_domains(domain, dkim_ok, dkim_selector, last_checked_at)), campaign_labels(label_id), campaign_contacts(contact_id)"
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr || !campaign) return { ...base, ok: false, error: "Campaign not found" };

  // Doc 11 §8: do not send from a domain whose DKIM is missing — receivers
  // treat that mail as forged, so the send costs sender reputation and
  // delivers nothing. sendingBlockedReason fails OPEN on a domain that has
  // never been checked, so this can never stop mail because the daily job
  // has not run yet.
  const sendingDomain = campaign.sending_identities?.sending_domains;
  if (sendingDomain) {
    let blocked = sendingBlockedReason(sendingDomain);
    if (blocked) {
      // The stored flag is a snapshot from the last check, which may be hours
      // or days old and may predate the DNS record being added. Never refuse a
      // send on stale information: re-read DNS now, and if the domain is in
      // fact authenticated, save the corrected verdict and carry on.
      const live = await checkDomain(
        sendingDomain.domain,
        sendingDomain.dkim_selector ?? null
      );
      if (!live.error) {
        await supabase
          .from("sending_domains")
          .update({
            spf_ok: live.spfOk,
            dkim_ok: live.dkimOk,
            dmarc_ok: live.dmarcOk,
            dkim_selector: live.dkimSelector ?? sendingDomain.dkim_selector,
            expected_records: live.expected,
            last_checked_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("domain", sendingDomain.domain);
        blocked = live.dkimOk ? null : blocked;
      }
      if (blocked) return { ...base, ok: false, error: blocked };
    }
  }

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
  const pickedCount = (campaign.campaign_contacts ?? []).length;
  if (labelCount === 0 && pickedCount === 0) {
    return { ...base, ok: false, error: "Campaign has no audience — add a label or individual contacts" };
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
          .order("contact_id", { ascending: true })
          .range(from, to)
    ),
    fetchAllRows<{ contact_id: string }>((from, to) =>
      supabase
        .from("campaign_recipients")
        .select("contact_id")
        .eq("campaign_id", campaignId)
        .order("contact_id", { ascending: true })
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

  const body = campaign.body_source as unknown as CampaignBody;
  const fromEmail = campaign.sending_identities.from_email;
  const fromName = campaign.sending_identities.from_name;
  const replyTo = campaign.sending_identities.reply_to;
  const brand = await getEffectiveBrand(supabase, campaign.sending_identity_id);

  type Recipient = { contact_id: string; email: string; first_name: string | null };
  const toSend = (pending as Recipient[]).slice(0, maxRecipients);
  const startedAt = Date.now();

  let sent = 0;
  let failed = 0;
  let processed = 0;
  let rateLimited = false;

  for (let i = 0; i < toSend.length; i += RESEND_BATCH_SIZE) {
    // Leave room inside the function's 60s limit to record the last chunk.
    if (i > 0 && Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
    const chunk = toSend.slice(i, i + RESEND_BATCH_SIZE);

    const emails = chunk.map((recipient) => {
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
      return {
        fromEmail,
        fromName,
        replyTo,
        to: recipient.email,
        subject: substituteFirstName(campaign.subject, firstName),
        html,
        text: `${text}\n\n———\nManage email preferences: ${prefsUrl}`,
        category: `campaign:${campaignId}`,
        headers: deliverabilityHeaders({
          prefsUrl,
          campaignId,
          fromEmail,
          contactId: recipient.contact_id,
        }),
      };
    });

    // Same campaign + same recipients → same key. A run that died after
    // Resend accepted this chunk but before we recorded it rebuilds the
    // identical chunk on resume, and Resend returns the original ids rather
    // than emailing these people a second time.
    const idempotencyKey = createHash("sha256")
      .update(`campaign:${campaignId}:${chunk.map((r) => r.contact_id).join(",")}`)
      .digest("hex");

    const batch = await sendBatchViaResend(emails, idempotencyKey);

    // Plan quota / rate limit: stop and record NOTHING for this chunk, so a
    // later run retries them. Recording it would burn the contacts — the bug
    // that once turned a throttle into 600+ fake "bounces".
    if (batch.rateLimited) {
      rateLimited = true;
      break;
    }

    const nowIso = new Date().toISOString();
    const rows = chunk.map((recipient, j) => {
      const r = batch.results[j];
      return r.error
        ? {
            campaign_id: campaignId,
            contact_id: recipient.contact_id,
            bounce_reason: r.error.slice(0, 300),
          }
        : {
            campaign_id: campaignId,
            contact_id: recipient.contact_id,
            provider_message_id: r.messageId,
            sent_at: nowIso,
          };
    });

    // ignoreDuplicates: if a concurrent run (the composer loop and the cron
    // overlapping) already recorded a contact, keep its row; Resend's
    // idempotency key already stopped the duplicate email itself.
    const { data: inserted } = await supabase
      .from("campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
      .select("id, contact_id");
    const idByContact = new Map<string, string>(
      ((inserted ?? []) as { id: string; contact_id: string }[]).map((r) => [
        r.contact_id,
        r.id,
      ])
    );

    const ledgerRows: LedgerMirror[] = [];
    const activityRows: Record<string, unknown>[] = [];
    chunk.forEach((recipient, j) => {
      const r = batch.results[j];
      processed++;
      if (r.error) failed++;
      else sent++;
      const legacyId = idByContact.get(recipient.contact_id);
      if (!legacyId) return; // recorded by another run — it owns the ledger row
      ledgerRows.push({
        legacyId,
        toEmail: recipient.email,
        contactId: recipient.contact_id,
        campaignId,
        campaignName: campaign.name,
        subject: campaign.subject,
        identityId: campaign.sending_identity_id,
        status: r.error ? "failed" : "sent",
        providerMessageId: r.messageId,
        error: r.error?.slice(0, 300) ?? null,
        sentAt: r.error ? null : nowIso,
      });
      if (!r.error) {
        activityRows.push({
          contact_id: recipient.contact_id,
          event_type: "email_sent",
          related_campaign_id: campaignId,
          occurred_at: nowIso,
        });
      }
    });
    await mirrorToLedger(supabase, ledgerRows);
    if (activityRows.length > 0) {
      await supabase.from("activity_events").insert(activityRows);
    }
  }

  // Recipients still awaiting a send after this run. Uses `processed` (rather
  // than the slice length) so an early stop is reflected correctly.
  const remaining = pending.length - processed;
  // Only flip to "sent" when the whole audience is drained AND we didn't stop
  // on a rate limit — otherwise a later run resumes the remainder.
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
