import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { settleAndNotify } from "@/lib/store/fulfil";
import {
  handleStoreStripeWebhook,
  storeStripeAllowed,
  storeStripeClient,
  storeStripeWebhookSecret,
  stripeWebhookStatus,
} from "@/lib/store/stripe";
import { cancelPendingOrder, claimStripeEvent, releaseStripeEvent } from "@/services/store";

// POST /api/store/stripe/webhook
//
// Stripe's webhook for Store orders only (international card payments).
// Event ticketing keeps its own endpoint at /api/integrations/stripe/notify.
// Register this URL as a SECOND endpoint in the Stripe Dashboard; it gets its
// own whsec_ (STORE_STRIPE_WEBHOOK_SECRET). Verifies the signature, dedupes on
// the event id (store_stripe_events), and settles through the same path as
// PayFast (settleAndNotify). 400 on a bad signature, 500 to ask Stripe to
// retry, otherwise 200.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const admin = storeAdminClient();
  const outcome = await handleStoreStripeWebhook(
    {
      enabled: () => storeStripeAllowed().ok,
      constructEvent: (body, signature) =>
        storeStripeClient().webhooks.constructEvent(body, signature, storeStripeWebhookSecret()!),
      claimEvent: (e) => claimStripeEvent(admin, e),
      releaseEvent: async (id) => {
        await releaseStripeEvent(admin, id);
      },
      loadOrder: async (id) => {
        const { data } = await admin
          .from("store_orders")
          .select("id, status, total_cents, payment_method, provider_payment_id")
          .eq("id", id)
          .maybeSingle();
        return data ?? null;
      },
      settle: (orderId, sessionId) => settleAndNotify(admin, { orderId, providerPaymentId: sessionId }),
      cancel: async (orderId) => {
        await cancelPendingOrder(admin, orderId);
      },
    },
    rawBody,
    request.headers.get("stripe-signature")
  );
  return NextResponse.json({ received: outcome !== "rejected" }, { status: stripeWebhookStatus(outcome) });
}
