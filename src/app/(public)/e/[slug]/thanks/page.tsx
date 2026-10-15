import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Order confirmed",
  description: "Your ticket order is confirmed. Your tickets are on their way by email.",
  openGraph: {
    title: "Order confirmed",
    description: "Your ticket order is confirmed. Your tickets are on their way by email.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { reconcileStripeOrder } from "@/lib/ticketing/reconcile-stripe";

export const dynamic = "force-dynamic";

export default async function ThanksPage({
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;

  let order: {
    status: string;
    buyer_email: string;
    payment_provider: string | null;
  } | null = null;
  if (orderId) {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("orders")
      .select(
        "id, status, buyer_email, payment_provider, total_cents, provider_reference"
      )
      .eq("id", orderId)
      .maybeSingle();

    // Safety net: if the buyer is back here but the order is still
    // pending on a Stripe (international card) payment, the webhook may
    // not have arrived. Ask Stripe directly and settle it now so the
    // buyer sees "confirmed" and gets their tickets without waiting.
    if (
      data &&
      data.status === "pending" &&
      data.payment_provider === "stripe"
    ) {
      const settled = await reconcileStripeOrder(supabase, data);
      if (settled.outcome === "settled") {
        const { data: refetched } = await supabase
          .from("orders")
          .select("id, status, buyer_email, payment_provider")
          .eq("id", orderId)
          .maybeSingle();
        order = refetched ?? data;
      } else {
        order = data;
      }
    } else {
      order = data ?? null;
    }
  }

  const status = order?.status ?? null;
  const buyerEmail = order?.buyer_email ?? null;
  const providerLabel =
    order?.payment_provider === "stripe" ? "Stripe" : "PayFast";

  return (
    <div className="w-full animate-fade-up">
      <Card>
        <CardContent className="p-8 sm:p-12 text-center space-y-3">
          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              width: 64,
              height: 64,
              backgroundColor: "var(--yellow-dim)",
              border: "1px solid var(--yellow-border)",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--yellow)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          {status === "paid" ? (
            <>
              <p className="page-eyebrow">Confirmed</p>
              <h1 className="page-title">Your tickets are on their way</h1>
              <p className="text-sm text-foreground/80 normal-case tracking-normal pt-2">
                We've emailed your tickets (with QR codes for the door) to{" "}
                <span className="font-semibold text-foreground">
                  {buyerEmail}
                </span>
                .
              </p>
              <p className="text-xs text-muted-foreground normal-case tracking-normal pt-2">
                Can't see it? Check your spam folder, or reply to the email to
                reach us.
              </p>
            </>
          ) : status === "invoiced" ? (
            <>
              <p className="page-eyebrow">Invoice sent</p>
              <h1 className="page-title">Your seats are held</h1>
              <p className="text-sm text-foreground/80 normal-case tracking-normal pt-2">
                We&apos;ve emailed an invoice to{" "}
                <span className="font-semibold text-foreground">{buyerEmail}</span>
                . You can pay it online in full or in parts.
              </p>
              <p className="text-xs text-muted-foreground normal-case tracking-normal pt-2">
                Your tickets (with QR codes for the door) are emailed as soon as
                the invoice is fully paid. Can&apos;t see the invoice? Check your
                spam folder, or reply to the email to reach us.
              </p>
            </>
          ) : status === "pending" ? (
            <>
              <p className="page-eyebrow">Processing</p>
              <h1 className="page-title">Payment is processing</h1>
              <p className="text-sm text-foreground/80 normal-case tracking-normal pt-2">
                We're confirming your payment with {providerLabel}. Your
                tickets will arrive in your inbox shortly.
              </p>
            </>
          ) : (
            <>
              <p className="page-eyebrow">Thanks</p>
              <h1 className="page-title">Thanks!</h1>
              <p className="text-sm text-foreground/80 normal-case tracking-normal pt-2">
                If you completed payment, your tickets will arrive by email
                shortly.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
