// FFSA Hub — Refund notification email.
//
// Mirrors fulfillment.ts's send path: same sending_identities lookup
// keyed by event brand, same Resend transport, same never-throw
// contract. A refund that moved real money must not be rolled back
// because an email bounced, so every failure here is logged and
// swallowed — the caller records the refund either way.

import { sendViaResend, isEmailConfigured } from "@/lib/email/resend-send";
import { refundConfirmationEmailHtml } from "@/lib/email/templates/refund-confirmation";
import { resolveEventBrand } from "./fulfillment";
import { resolveEventSender } from "@/lib/email/event-sender";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmail, markSent, markFailed } from "@/lib/email/ledger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function sendRefundEmail(
  supabase: Client,
  opts: {
    orderId: string;
    buyerFirstName: string;
    buyerEmail: string;
    event: {
      title: string;
      brand?: string | null;
      public_slug?: string | null;
      sending_identity_id?: string | null;
      email_show_event_logo?: boolean | null;
      logo_url?: string | null;
    };
    eventId?: string | null;
    contactId?: string | null;
    refundedCents: number;
    totalRefundedCents: number;
    orderTotalCents: number;
    isFullRefund: boolean;
    /** The order's currency (orders.currency). */
    currency: string;
    /** Buyer-facing note, e.g. why the event was cancelled. */
    cancellationMessage?: string | null;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.warn(
      "[refund-email] RESEND_API_KEY not set; refund recorded without emailing the buyer"
    );
    return { sent: false, error: "Email is not configured." };
  }

  const brand = resolveEventBrand(opts.event);
  // The event's own email settings (migration 241), else its brand's sender.
  const sender = await resolveEventSender(supabase, opts.event, brand);
  const subject = opts.isFullRefund
    ? `Your refund for ${opts.event.title}`
    : `A partial refund for ${opts.event.title}`;

  // Logged in the email ledger like every other buyer email, so a refund
  // notice can't vanish without a trace. Best-effort; never blocks.
  const admin = createAdminClient();
  const ledgerId = await recordEmail(admin, {
    toEmail: opts.buyerEmail,
    provider: "resend",
    category: "refund_confirmation",
    subject,
    contactId: opts.contactId ?? null,
    eventId: opts.eventId ?? null,
    orderId: opts.orderId,
    reason: `Her order for ${opts.event.title} was refunded`,
  });

  const result = await sendViaResend({
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    replyTo: sender.replyTo,
    to: opts.buyerEmail,
    subject,
    html: refundConfirmationEmailHtml({
      buyerFirstName: opts.buyerFirstName,
      eventTitle: opts.event.title,
      orderId: opts.orderId,
      refundedCents: opts.refundedCents,
      totalRefundedCents: opts.totalRefundedCents,
      orderTotalCents: opts.orderTotalCents,
      isFullRefund: opts.isFullRefund,
      currency: opts.currency,
      cancellationMessage: opts.cancellationMessage ?? null,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com",
      headerLogoUrl: sender.headerLogoUrl,
    }),
    category: "refund_confirmation",
  });
  if (result.error) await markFailed(admin, ledgerId, result.error);
  else await markSent(admin, ledgerId, result.messageId);

  if (result.error) {
    console.error("[refund-email] failed to send:", result.error);
    return { sent: false, error: String(result.error) };
  }
  return { sent: true };
}
