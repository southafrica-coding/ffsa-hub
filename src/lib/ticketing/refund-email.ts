// FFSA Hub — Refund notification email.
//
// Mirrors fulfillment.ts's send path: same sending_identities lookup
// keyed by event brand, same Mailtrap transport, same never-throw
// contract. A refund that moved real money must not be rolled back
// because an email bounced, so every failure here is logged and
// swallowed — the caller records the refund either way.

import { sendViaMailtrap } from "@/lib/email/mailtrap";
import { refundConfirmationEmailHtml } from "@/lib/email/templates/refund-confirmation";
import { resolveEventBrand, identitySlugForBrand } from "./fulfillment";

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
    };
    refundedCents: number;
    totalRefundedCents: number;
    orderTotalCents: number;
    isFullRefund: boolean;
    /** The order's currency (orders.currency). */
    currency: string;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!process.env.MAILTRAP_API_TOKEN) {
    console.warn(
      "[refund-email] MAILTRAP_API_TOKEN not set; refund recorded without emailing the buyer"
    );
    return { sent: false, error: "Email is not configured." };
  }

  const brand = resolveEventBrand(opts.event);
  const { data: identity } = await supabase
    .from("sending_identities")
    .select("from_email, from_name, reply_to")
    .eq("slug", identitySlugForBrand(brand))
    .eq("is_active", true)
    .maybeSingle();

  const fromEmail =
    identity?.from_email ||
    process.env.MAILTRAP_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    "noreply@ffsahub.com";

  const result = await sendViaMailtrap({
    fromEmail,
    fromName: identity?.from_name || "Fire & Fragrance SA",
    replyTo: identity?.reply_to ?? null,
    to: opts.buyerEmail,
    subject: opts.isFullRefund
      ? `Your refund for ${opts.event.title}`
      : `A partial refund for ${opts.event.title}`,
    html: refundConfirmationEmailHtml({
      buyerFirstName: opts.buyerFirstName,
      eventTitle: opts.event.title,
      orderId: opts.orderId,
      refundedCents: opts.refundedCents,
      totalRefundedCents: opts.totalRefundedCents,
      orderTotalCents: opts.orderTotalCents,
      isFullRefund: opts.isFullRefund,
      currency: opts.currency,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com",
    }),
    category: "refund_confirmation",
  });

  if (result.error) {
    console.error("[refund-email] failed to send:", result.error);
    return { sent: false, error: String(result.error) };
  }
  return { sent: true };
}
