// FFSA Hub — Event cancellation notice sender.
//
// Emails the ticket holders of a cancelled event to explain WHY it was
// cancelled (the refund email tells them the money is coming back; this
// tells them the reason). Uses the event's stored cancellation_message
// so there is a single source of truth, and the same brand-keyed sending
// identity + Mailtrap transport as the refund email.
//
// Scope: buyers who have already had money refunded (refund_cents > 0),
// deduplicated by email — those are the people who got a reason-less
// refund email. Never throws; returns a per-recipient summary.

import { sendViaMailtrap } from "@/lib/email/mailtrap";
import { eventCancellationNoticeEmailHtml } from "@/lib/email/templates/event-cancellation-notice";
import { resolveEventBrand, identitySlugForBrand } from "@/lib/ticketing/fulfillment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type Recipient = { email: string; firstName: string; orderCount: number };

export type CancellationNoticeResult =
  | {
      ok: true;
      dryRun: boolean;
      recipients: Recipient[];
      /** Present only on a real send. */
      sent?: number;
      failed?: number;
      failures?: Array<{ email: string; error: string }>;
      /** Rendered HTML for a dry-run preview. */
      previewHtml?: string;
    }
  | { ok: false; error: string; httpStatus: number };

const REFUND_LINE =
  "Your refund for this event has been processed and is on its way back to the card or account you paid from — no action is needed on your side.";

/** Buyers of the event who have already been refunded, deduped by email. */
async function refundedRecipients(
  supabase: Client,
  eventId: string
): Promise<Recipient[]> {
  const { data } = await supabase
    .from("orders")
    .select("buyer_first_name, buyer_email, refund_cents")
    .eq("event_id", eventId)
    .gt("refund_cents", 0);

  const byEmail = new Map<string, Recipient>();
  for (const o of (data ?? []) as Array<{
    buyer_first_name: string | null;
    buyer_email: string | null;
    refund_cents: number;
  }>) {
    const email = (o.buyer_email ?? "").trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.orderCount += 1;
    } else {
      byEmail.set(email, {
        email,
        firstName: (o.buyer_first_name ?? "").trim(),
        orderCount: 1,
      });
    }
  }
  return [...byEmail.values()];
}

export async function sendCancellationNotice(
  supabase: Client,
  eventId: string,
  opts: { dryRun: boolean }
): Promise<CancellationNoticeResult> {
  const { data: event } = await supabase
    .from("events")
    .select("id, title, brand, public_slug, status, cancellation_message")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) {
    return { ok: false, error: "Event not found", httpStatus: 404 };
  }
  const message = (event.cancellation_message ?? "").trim();
  if (!message) {
    return {
      ok: false,
      error:
        "This event has no cancellation message saved yet. Add the reason on the event first, then send.",
      httpStatus: 400,
    };
  }

  const recipients = await refundedRecipients(supabase, eventId);

  const html = eventCancellationNoticeEmailHtml({
    eventTitle: event.title,
    message,
    refundLine: REFUND_LINE,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com",
  });

  // Dry run: show who would receive it and exactly what they'd get.
  if (opts.dryRun) {
    return { ok: true, dryRun: true, recipients, previewHtml: html };
  }

  if (!process.env.MAILTRAP_API_TOKEN) {
    return {
      ok: false,
      error: "Email is not configured (MAILTRAP_API_TOKEN missing).",
      httpStatus: 500,
    };
  }

  const brand = resolveEventBrand(event);
  const { data: identity } = await supabase
    .from("sending_identities")
    .select("from_email, from_name, reply_to")
    .eq("slug", identitySlugForBrand(brand))
    .eq("is_active", true)
    .maybeSingle();

  const fromEmail = (
    identity?.from_email ||
    process.env.MAILTRAP_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    "noreply@ffsahub.com"
  ).trim();
  const subject = `${event.title} has been cancelled`;

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const r of recipients) {
    const result = await sendViaMailtrap({
      fromEmail,
      fromName: identity?.from_name || "Fire & Fragrance SA",
      replyTo: identity?.reply_to ?? null,
      to: r.email,
      subject,
      html,
      category: "event_cancellation_notice",
    });
    if (result.error) {
      failures.push({ email: r.email, error: result.error });
    } else {
      sent += 1;
    }
  }

  return {
    ok: true,
    dryRun: false,
    recipients,
    sent,
    failed: failures.length,
    failures,
  };
}
