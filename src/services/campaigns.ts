import type { TablesInsert, TablesUpdate } from "@/types/database";

type CampaignInsert = TablesInsert<"campaigns">;
type CampaignUpdate = TablesUpdate<"campaigns">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Campaigns
// ────────────────────────────────────────────────────────────

export async function listCampaigns(
  supabase: Client,
  options?: { status?: string; limit?: number; offset?: number }
) {
  let query = supabase
    .from("campaigns")
    .select(
      "id, name, subject, status, scheduled_at, sent_at, created_at, campaign_labels(labels(id, slug, name, color))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (options?.status) query = query.eq("status", options.status);
  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }
  return query;
}

export async function getCampaignById(supabase: Client, id: string) {
  return supabase
    .from("campaigns")
    .select(
      "*, campaign_labels(labels(id, slug, name, color)), sending_identities(id, slug, display_name, from_email, from_name, provider)"
    )
    .eq("id", id)
    .maybeSingle();
}

export async function createCampaign(supabase: Client, data: CampaignInsert) {
  return supabase.from("campaigns").insert(data).select().single();
}

export async function updateCampaign(
  supabase: Client,
  id: string,
  data: CampaignUpdate
) {
  return supabase
    .from("campaigns")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteCampaign(supabase: Client, id: string) {
  return supabase.from("campaigns").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// Campaign ↔ label mapping
// ────────────────────────────────────────────────────────────

export async function getCampaignLabelIds(
  supabase: Client,
  campaignId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("campaign_labels")
    .select("label_id")
    .eq("campaign_id", campaignId);
  return ((data ?? []) as { label_id: string }[]).map((r) => r.label_id);
}

/**
 * Replace the audience labels for a campaign. Delete-then-insert to keep
 * the set in sync with the provided ids. Safe because campaign_labels has
 * no extra metadata that would be lost.
 */
export async function setCampaignLabels(
  supabase: Client,
  campaignId: string,
  labelIds: string[]
) {
  const dedup = Array.from(new Set(labelIds.filter(Boolean)));
  const del = await supabase
    .from("campaign_labels")
    .delete()
    .eq("campaign_id", campaignId);
  if (del.error) return del;
  if (dedup.length === 0) return { data: [], error: null };

  return supabase
    .from("campaign_labels")
    .insert(dedup.map((label_id) => ({ campaign_id: campaignId, label_id })))
    .select();
}

// ────────────────────────────────────────────────────────────
// Audience + recipients
// ────────────────────────────────────────────────────────────

/** Contacts who would receive this campaign — DISTINCT across all its labels. */
export async function getCampaignAudience(supabase: Client, campaignId: string) {
  return supabase
    .from("v_campaign_audience")
    .select("contact_id, email, email_normalized, first_name, last_name")
    .eq("campaign_id", campaignId);
}

export async function getCampaignAudienceCount(
  supabase: Client,
  campaignId: string
) {
  const { count } = await supabase
    .from("v_campaign_audience")
    .select("contact_id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

/**
 * Per-recipient delivery rows for a sent campaign — drives the per-contact
 * status table. Embeds the contact's name/email for display.
 */
export async function getCampaignRecipients(supabase: Client, campaignId: string) {
  return supabase
    .from("campaign_recipients")
    .select(
      "id, contact_id, sent_at, delivered_at, opened_at, first_clicked_at, bounced_at, complained_at, unsubscribed_at, contacts(first_name, last_name, email)"
    )
    .eq("campaign_id", campaignId)
    .order("bounced_at", { ascending: false, nullsFirst: false })
    .order("sent_at", { ascending: true });
}

export type CampaignStats = {
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
};

/** Aggregate delivery metrics for a campaign, via head-count queries. */
export async function getCampaignStats(
  supabase: Client,
  campaignId: string
): Promise<CampaignStats> {
  const base = () =>
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

  const [total, sent, delivered, opened, clicked, bounced, unsubscribed] =
    await Promise.all([
      base(),
      base().not("sent_at", "is", null),
      base().not("delivered_at", "is", null),
      base().not("opened_at", "is", null),
      base().not("first_clicked_at", "is", null),
      // A message that was ultimately delivered is not a bounce. Transient
      // bounces (e.g. Mailtrap "hourly_rate_exceeded") stamp bounced_at on the
      // first attempt but later succeed and set delivered_at — exclude those so
      // the count reflects genuinely undelivered recipients only.
      base().not("bounced_at", "is", null).is("delivered_at", null),
      base().not("unsubscribed_at", "is", null),
    ]);

  return {
    total: total.count ?? 0,
    sent: sent.count ?? 0,
    delivered: delivered.count ?? 0,
    opened: opened.count ?? 0,
    clicked: clicked.count ?? 0,
    bounced: bounced.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
  };
}

// ────────────────────────────────────────────────────────────
// Sending identities
// ────────────────────────────────────────────────────────────

export async function listSendingIdentities(supabase: Client) {
  return supabase
    .from("sending_identities")
    .select("*")
    .eq("is_active", true)
    .order("display_name");
}
