// ────────────────────────────────────────────────────────────
// FFSA Hub — who an event's emails come from, and what they look like
// ────────────────────────────────────────────────────────────
// One answer for every email an event sends — ticket confirmation, refund,
// cancellation notice, feedback invites, pay-later invoice (migration 241):
//
//   1. the event's own sender (events.sending_identity_id), else
//   2. its brand's sender (sending_identities by slug), else
//   3. the shared "events" sender, else
//   4. the environment default — the behaviour before identities existed.
//
// The sender carries the From name + address, the Hub reply address
// (<slug>@ffsahub.com — replies land on the buyer's record and are
// forwarded to the sender's forward_to inboxes).
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type EventBrandKey = "ff" | "the_send" | "ffsa_camps" | "preachers" | "wild_ones" | "missio";

export interface EventEmailEvent {
  brand?: string | null;
  public_slug?: string | null;
  title?: string | null;
  sending_identity_id?: string | null;
  email_show_event_logo?: boolean | null;
  logo_url?: string | null;
}

export interface EventEmailSender {
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  /** The sending_identities row used, when one was. */
  identityId: string | null;
  /** Set when the event shows its own logo at the top of its emails. */
  headerLogoUrl: string | null;
}

/**
 * Identity slugs to try for a brand, in order. The Send's identity was
 * seeded as "the-send" but lives in production as "the-send-south-africa",
 * so both are tried — before this its emails silently fell back to the
 * generic default sender.
 */
export function brandIdentitySlugs(brand: EventBrandKey): string[] {
  switch (brand) {
    case "the_send":
      return ["the-send", "the-send-south-africa", "events"];
    case "ffsa_camps":
      return ["ffsa-camps", "events"];
    case "preachers":
      return ["preachers", "events"];
    default:
      return ["events"];
  }
}

/** The event's logo for the top of its emails, when it asked for one. */
export function eventHeaderLogo(event: EventEmailEvent): string | null {
  const url = event.email_show_event_logo ? event.logo_url?.trim() : null;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

type IdentityRow = { id: string; slug: string; from_email: string; from_name: string; reply_to: string | null };

export async function resolveEventSender(
  supabase: Client,
  event: EventEmailEvent,
  brand: EventBrandKey
): Promise<EventEmailSender> {
  const headerLogoUrl = eventHeaderLogo(event);

  if (event.sending_identity_id) {
    const { data } = await supabase
      .from("sending_identities")
      .select("id, slug, from_email, from_name, reply_to")
      .eq("id", event.sending_identity_id)
      .eq("is_active", true)
      .maybeSingle();
    if (data) return fromIdentity(data as IdentityRow, headerLogoUrl);
  }

  const slugs = brandIdentitySlugs(brand);
  const { data: rows } = await supabase
    .from("sending_identities")
    .select("id, slug, from_email, from_name, reply_to")
    .in("slug", slugs)
    .eq("is_active", true);
  const found = slugs.map((s) => ((rows ?? []) as IdentityRow[]).find((r) => r.slug === s)).find(Boolean);
  if (found) return fromIdentity(found, headerLogoUrl);

  return {
    fromEmail: (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim(),
    fromName: "Fire & Fragrance SA",
    replyTo: null,
    identityId: null,
    headerLogoUrl,
  };
}

function fromIdentity(r: IdentityRow, headerLogoUrl: string | null): EventEmailSender {
  return {
    fromEmail: r.from_email.trim(),
    fromName: r.from_name || "Fire & Fragrance SA",
    replyTo: r.reply_to ?? null,
    identityId: r.id,
    headerLogoUrl,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The event's logo as the first thing in an email body. Centred, capped so
 * a tall or wide upload can't take over the message, on a plain cell so it
 * reads on both the dark brand shells and white emails.
 */
export function eventLogoBlock(url: string | null | undefined, alt = "Event logo"): string {
  if (!url) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td align="center"><img src="${esc(url)}" alt="${esc(alt)}" style="display:block;margin:0 auto;max-width:240px;max-height:96px;width:auto;height:auto;border:0;" /></td></tr></table>`;
}
