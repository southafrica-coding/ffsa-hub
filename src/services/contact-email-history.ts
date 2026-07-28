// FFSA Hub — Per-contact email history (Phase 2 of the deliverability
// layer). One unified, delivery-aware view of every email a person has
// received, drawn from the three places the Hub records sends:
//
//   campaign_recipients      — broadcast/campaign email
//   workflow_email_sends     — automated workflow-step email
//   email_messages (migr 141)— transactional email (tickets, invites,
//                              references, …) — the bucket Phase 1 added
//
// Each source stores the same delivery signals (sent/delivered/opened/
// bounced/complained), so we normalize them into one shape and merge.
// Every query degrades to empty on error, so a not-yet-migrated table or
// a missing join never blanks the whole panel.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ContactEmailChannel = "campaign" | "workflow" | "transactional";

export type ContactEmailStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "failed"
  | "dropped";

export type ContactEmailItem = {
  id: string;
  channel: ContactEmailChannel;
  /** Best available human title for the email. */
  subject: string;
  /** Secondary context — campaign name, ticket category, etc. */
  context: string | null;
  status: ContactEmailStatus;
  /** Bounce/complaint/error detail, when known. */
  reason: string | null;
  /** When it was sent (or created, for transactional rows). */
  sentAt: string | null;
};

// The campaign/workflow tables have no status column — they record only
// timestamps — so derive a single status from them, strongest-signal
// first. (email_messages already carries a normalized status.)
type DeliveryTimestamps = {
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  first_clicked_at?: string | null;
  bounced_at?: string | null;
  complained_at?: string | null;
  unsubscribed_at?: string | null;
};

function deriveStatus(t: DeliveryTimestamps): ContactEmailStatus {
  if (t.complained_at) return "complained";
  if (t.bounced_at) return "bounced";
  if (t.opened_at || t.first_clicked_at) return "opened";
  if (t.delivered_at) return "delivered";
  if (t.unsubscribed_at) return "unsubscribed";
  if (t.sent_at) return "sent";
  return "queued";
}

export async function getContactEmailHistory(
  admin: Client,
  contactId: string
): Promise<ContactEmailItem[]> {
  const [campaigns, workflows, transactional] = await Promise.all([
    fetchCampaignEmails(admin, contactId),
    fetchWorkflowEmails(admin, contactId),
    fetchTransactionalEmails(admin, contactId),
  ]);

  return [...campaigns, ...workflows, ...transactional].sort((a, b) => {
    const ta = a.sentAt ? Date.parse(a.sentAt) : 0;
    const tb = b.sentAt ? Date.parse(b.sentAt) : 0;
    return tb - ta; // newest first
  });
}

async function fetchCampaignEmails(
  admin: Client,
  contactId: string
): Promise<ContactEmailItem[]> {
  const { data, error } = await admin
    .from("campaign_recipients")
    .select(
      "id, sent_at, delivered_at, opened_at, first_clicked_at, bounced_at, bounce_reason, complained_at, unsubscribed_at, campaigns(name, subject)"
    )
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: `campaign:${r.id}`,
    channel: "campaign" as const,
    subject: r.campaigns?.subject ?? r.campaigns?.name ?? "Campaign email",
    context: r.campaigns?.name ?? null,
    status: deriveStatus(r),
    reason: r.bounce_reason ?? null,
    sentAt: r.sent_at ?? null,
  }));
}

async function fetchWorkflowEmails(
  admin: Client,
  contactId: string
): Promise<ContactEmailItem[]> {
  const { data, error } = await admin
    .from("workflow_email_sends")
    .select(
      "id, sent_at, delivered_at, opened_at, first_clicked_at, bounced_at, bounce_reason, complained_at, unsubscribed_at"
    )
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: `workflow:${r.id}`,
    channel: "workflow" as const,
    subject: "Automated workflow email",
    context: null,
    status: deriveStatus(r),
    reason: r.bounce_reason ?? null,
    sentAt: r.sent_at ?? null,
  }));
}

async function fetchTransactionalEmails(
  admin: Client,
  contactId: string
): Promise<ContactEmailItem[]> {
  const { data, error } = await admin
    .from("email_messages")
    .select(
      "id, category, subject, status, error, sent_at, delivered_at, opened_at, bounced_at, complained_at, created_at"
    )
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: `transactional:${r.id}`,
    channel: "transactional" as const,
    subject: r.subject ?? categoryLabel(r.category) ?? "Transactional email",
    context: categoryLabel(r.category),
    // email_messages already stores a normalized status; trust it.
    status: (r.status as ContactEmailStatus) ?? "sent",
    reason: r.error ?? null,
    sentAt: r.sent_at ?? r.created_at ?? null,
  }));
}

// Turn a raw category slug into a readable label.
function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
