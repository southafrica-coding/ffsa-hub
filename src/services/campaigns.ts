import type { TablesInsert, TablesUpdate } from "@/types/database";
import { isPreferencesLink } from "@/lib/campaigns/link-labels";

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
  data: CampaignUpdate,
  options?: { onlyStatuses?: readonly string[] }
) {
  let query = supabase
    .from("campaigns")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (options?.onlyStatuses?.length) {
    query = query.in("status", [...options.onlyStatuses]);
  }
  // maybeSingle so zero matching rows (status moved on, usually to sending)
  // is { data: null }, not a PostgREST error the route would report as 500.
  return query.select().maybeSingle();
}

export async function deleteCampaign(
  supabase: Client,
  id: string,
  options?: { onlyStatuses?: readonly string[] }
) {
  let query = supabase.from("campaigns").delete().eq("id", id);
  if (options?.onlyStatuses?.length) {
    query = query.in("status", [...options.onlyStatuses]);
  }
  return query.select("id").maybeSingle();
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
// Hand-picked contacts (migration 234)
// ────────────────────────────────────────────────────────────

export type PickableContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  /**
   * Why this person won't actually be emailed, or null when they will. Same
   * rules as v_campaign_audience, so the composer can say so before sending
   * rather than the count quietly not moving.
   */
  blocked: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_normalized: string | null;
  marketing_status: string | null;
};

const PICKABLE_COLUMNS =
  "id, first_name, last_name, email, email_normalized, marketing_status";

/** Annotate contacts with the reason (if any) they can't receive a campaign. */
async function withMailability(
  supabase: Client,
  rows: ContactRow[]
): Promise<PickableContact[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const emails = rows.map((r) => r.email_normalized).filter(Boolean) as string[];
  const [{ data: unsubs }, { data: supps }] = await Promise.all([
    supabase
      .from("unsubscribes")
      .select("contact_id")
      .in("contact_id", ids)
      .is("label_id", null),
    emails.length > 0
      ? supabase
          .from("email_suppressions")
          .select("email_normalized, reason")
          .in("email_normalized", emails)
      : Promise.resolve({ data: [] }),
  ]);
  const unsubscribed = new Set(
    ((unsubs ?? []) as { contact_id: string }[]).map((u) => u.contact_id)
  );
  const suppressed = new Map(
    ((supps ?? []) as { email_normalized: string; reason: string }[]).map((x) => [
      x.email_normalized,
      x.reason,
    ])
  );
  return rows.map((r) => {
    let blocked: string | null = null;
    if (!r.email || !r.email_normalized) blocked = "No email address";
    else if (unsubscribed.has(r.id) || r.marketing_status !== "subscribed")
      blocked = "Unsubscribed";
    else if (suppressed.has(r.email_normalized))
      blocked =
        suppressed.get(r.email_normalized) === "complaint"
          ? "Marked as spam"
          : "Email bounced";
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      blocked,
    };
  });
}

/** The contacts hand-picked onto a campaign, with their mailability. */
export async function getCampaignContacts(
  supabase: Client,
  campaignId: string
): Promise<PickableContact[]> {
  const { data } = await supabase
    .from("campaign_contacts")
    .select(`contacts(${PICKABLE_COLUMNS})`)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(1000);
  const rows = ((data ?? []) as { contacts: ContactRow | null }[])
    .map((r) => r.contacts)
    .filter((c): c is ContactRow => !!c);
  return withMailability(supabase, rows);
}

/**
 * Contacts matching a name or email, for the composer's "add individual
 * contacts" search. Every whitespace-separated token must match some column,
 * so "jane smith" finds Jane Smith.
 */
export async function searchPickableContacts(
  supabase: Client,
  q: string,
  limit = 12
): Promise<PickableContact[]> {
  const tokens = q
    .trim()
    .split(/\s+/)
    // Strip PostgREST reserved characters so a token can't break the or().
    .map((t) => t.replace(/[,()*%]/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  if (tokens.length === 0) return [];
  let query = supabase
    .from("contacts")
    .select(PICKABLE_COLUMNS)
    .order("first_name", { ascending: true })
    .limit(limit);
  for (const t of tokens) {
    query = query.or(
      ["first_name", "last_name", "preferred_name", "email"]
        .map((c) => `${c}.ilike.%${t}%`)
        .join(",")
    );
  }
  const { data } = await query;
  return withMailability(supabase, (data ?? []) as ContactRow[]);
}

/** Ids of the contacts hand-picked onto a campaign. */
export async function getCampaignContactIds(
  supabase: Client,
  campaignId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("campaign_contacts")
    .select("contact_id")
    .eq("campaign_id", campaignId);
  return ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
}

/** Replace the hand-picked contacts on a campaign (delete-then-insert). */
export async function setCampaignContacts(
  supabase: Client,
  campaignId: string,
  contactIds: string[],
  addedBy: string | null
) {
  const dedup = Array.from(new Set(contactIds.filter(Boolean)));
  const del = await supabase
    .from("campaign_contacts")
    .delete()
    .eq("campaign_id", campaignId);
  if (del.error) return del;
  if (dedup.length === 0) return { data: [], error: null };
  return supabase
    .from("campaign_contacts")
    .insert(
      dedup.map((contact_id) => ({
        campaign_id: campaignId,
        contact_id,
        added_by: addedBy,
      }))
    )
    .select("contact_id");
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

// ────────────────────────────────────────────────────────────
// Per-link clicks (migration 227)
// ────────────────────────────────────────────────────────────

export type LinkClicker = {
  contactId: string | null;
  name: string;
  email: string | null;
  clicks: number;
  lastClickedAt: string;
};

export type CampaignLinkStat = {
  /** Destination URL, or "preferences" for the folded per-recipient link. */
  url: string;
  clicks: number;
  uniqueClickers: number;
  lastClickedAt: string;
  clickers: LinkClicker[];
};

type ClickRow = {
  url: string;
  contact_id: string | null;
  clicked_at: string;
  contacts: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

/**
 * Every link clicked in a campaign: total clicks, distinct people, and who.
 * Paged past PostgREST's 1000-row cap so a big send's report is complete.
 * Sorted most-clicked first.
 */
export async function getCampaignLinkClicks(
  supabase: Client,
  campaignId: string
): Promise<CampaignLinkStat[]> {
  const rows: ClickRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data } = await supabase
      .from("email_link_clicks")
      .select("url, contact_id, clicked_at, contacts(first_name, last_name, email)")
      .eq("campaign_id", campaignId)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    const batch = (data ?? []) as ClickRow[];
    rows.push(...batch);
    if (batch.length < page) break;
  }

  const byUrl = new Map<string, { stat: CampaignLinkStat; people: Map<string, LinkClicker> }>();
  for (const r of rows) {
    const key = isPreferencesLink(r.url) ? "preferences" : r.url;
    let entry = byUrl.get(key);
    if (!entry) {
      entry = {
        stat: { url: key, clicks: 0, uniqueClickers: 0, lastClickedAt: r.clicked_at, clickers: [] },
        people: new Map(),
      };
      byUrl.set(key, entry);
    }
    entry.stat.clicks++;
    if (r.clicked_at > entry.stat.lastClickedAt) entry.stat.lastClickedAt = r.clicked_at;

    const personKey = r.contact_id ?? "unknown";
    const person = entry.people.get(personKey) ?? {
      contactId: r.contact_id,
      name:
        [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ") ||
        r.contacts?.email ||
        "Unknown contact",
      email: r.contacts?.email ?? null,
      clicks: 0,
      lastClickedAt: r.clicked_at,
    };
    person.clicks++;
    if (r.clicked_at > person.lastClickedAt) person.lastClickedAt = r.clicked_at;
    entry.people.set(personKey, person);
  }

  return [...byUrl.values()]
    .map(({ stat, people }) => ({
      ...stat,
      uniqueClickers: people.size,
      clickers: [...people.values()].sort((a, b) => b.clicks - a.clicks),
    }))
    .sort((a, b) => b.clicks - a.clicks);
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

/**
 * Same counters as getCampaignStats, but for many campaigns in ONE query
 * against v_campaign_stats (migration 164). getCampaignStats costs seven
 * head-counts per campaign, which a 25-row list cannot afford.
 *
 * Degrades to an empty map — never throws, never surfaces an error — when
 * the view is missing. This code ships before migration 164 is applied by
 * hand in the Supabase dashboard, and a list that quietly omits its rates
 * is far better than a Communications page that 500s.
 */
export async function getCampaignStatsBulk(
  supabase: Client,
  campaignIds: string[]
): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();

  const ids = Array.from(new Set(campaignIds.filter(Boolean)));
  if (ids.length === 0) return out; // no round trip for an empty list

  try {
    const { data, error } = await supabase
      .from("v_campaign_stats")
      .select(
        "campaign_id, total, sent, delivered, opened, clicked, bounced, unsubscribed"
      )
      .in("campaign_id", ids);

    // View not created yet (PostgREST 42P01 / PGRST205) or any other read
    // failure: fall through to the empty map, callers render "—".
    if (error || !data) return out;

    for (const row of data as Record<string, unknown>[]) {
      const id = row.campaign_id;
      if (typeof id !== "string") continue;
      out.set(id, {
        // Counts arrive as ints from the view; coerce defensively so a
        // bigint-as-string can never reach the rate arithmetic as NaN.
        total: num(row.total),
        sent: num(row.sent),
        delivered: num(row.delivered),
        opened: num(row.opened),
        clicked: num(row.clicked),
        bounced: num(row.bounced),
        unsubscribed: num(row.unsubscribed),
      });
    }
  } catch {
    return out;
  }

  return out;
}

/** Empty-safe counter coercion — anything unparseable counts as zero. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
