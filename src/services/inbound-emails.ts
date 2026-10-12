// Inbound replies (migration 228) — reads + triage for the Communications Inbox.
// Rows are written only by the Resend webhook (src/lib/email/inbound.ts).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type InboundStatus = "new" | "read" | "handled" | "archived";

export type InboundEmail = {
  id: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  attachments: { id: string; filename: string | null; size: number; content_type: string }[];
  received_at: string;
  identity_id: string | null;
  contact_id: string | null;
  is_auto_reply: boolean;
  status: InboundStatus;
  handled_at: string | null;
  forwarded_to: string[];
  forwarded_at: string | null;
  forward_error: string | null;
  sending_identities: { display_name: string } | null;
  contacts: { first_name: string | null; last_name: string | null } | null;
};

export const INBOUND_STATUSES: InboundStatus[] = ["new", "read", "handled", "archived"];

/** Newest first, capped — the Inbox is a work queue, not an archive search. */
export async function listInboundEmails(
  supabase: Client,
  opts: { status?: InboundStatus | "open"; identityId?: string; limit?: number } = {}
) {
  let q = supabase
    .from("inbound_emails")
    .select(
      "id, from_email, from_name, to_emails, cc_emails, subject, text_body, html_body, attachments, received_at, identity_id, contact_id, is_auto_reply, status, handled_at, forwarded_to, forwarded_at, forward_error, sending_identities(display_name), contacts(first_name, last_name)"
    )
    .order("received_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status === "open") q = q.in("status", ["new", "read"]);
  else if (opts.status) q = q.eq("status", opts.status);
  if (opts.identityId) q = q.eq("identity_id", opts.identityId);
  return q;
}

/** For the sub-nav badge: replies nobody has looked at yet. */
export async function countNewInbound(supabase: Client): Promise<number> {
  const { count } = await supabase
    .from("inbound_emails")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  return count ?? 0;
}

export async function setInboundStatus(
  supabase: Client,
  id: string,
  status: InboundStatus,
  userId: string
) {
  const handled = status === "handled";
  return supabase
    .from("inbound_emails")
    .update({
      status,
      handled_by: handled ? userId : null,
      handled_at: handled ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id, status, handled_at")
    .single();
}

export type InboxReply = {
  id: string;
  inbound_email_id: string;
  from_email: string;
  from_name: string;
  to_email: string;
  body_text: string;
  status: "sent" | "failed";
  error: string | null;
  sent_at: string;
};

/** Hub replies sent to the given inbound emails, oldest first (migration 229). */
export async function listInboxReplies(
  supabase: Client,
  inboundIds: string[]
): Promise<InboxReply[]> {
  if (inboundIds.length === 0) return [];
  const { data } = await supabase
    .from("inbound_email_replies")
    .select("id, inbound_email_id, from_email, from_name, to_email, body_text, status, error, sent_at")
    .in("inbound_email_id", inboundIds)
    .order("sent_at", { ascending: true })
    .limit(1000);
  return (data ?? []) as InboxReply[];
}
