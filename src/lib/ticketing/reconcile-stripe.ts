import type { createAdminClient } from "@/lib/supabase/admin";
import { retrieveStripeCheckoutStatus } from "@/lib/payments/stripe";
import { settlePaidOrder, type SettleResult } from "./settle";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ReconcileOrder = {
  id: string;
  status: string;
  total_cents: number;
  payment_provider: string | null;
  provider_reference: string | null;
};

export type ReconcileResult =
  | { outcome: "settled" }
  | { outcome: "already" }
  | { outcome: "amount_mismatch" }
  | { outcome: "not_paid_yet" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; error: string };

// Ask Stripe directly whether a pending order's Checkout Session was
// actually paid, and settle it if so. This is the safety net for the
// webhook: if `checkout.session.completed` never reached us (endpoint
// mis-registered, wrong signing secret, transient outage), the buyer's
// money is captured on Stripe but the order is stuck pending. Retrieving
// the session recovers it without relying on the webhook.
export async function reconcileStripeOrder(
  supabase: AdminClient,
  order: ReconcileOrder
): Promise<ReconcileResult> {
  if (order.status !== "pending") {
    return { outcome: "skipped", reason: "not pending" };
  }
  if (order.payment_provider !== "stripe") {
    return { outcome: "skipped", reason: "not a Stripe order" };
  }
  if (!order.provider_reference) {
    // No session id stored — checkout never reached Stripe.
    return { outcome: "skipped", reason: "no provider reference" };
  }

  let status;
  try {
    status = await retrieveStripeCheckoutStatus(order.provider_reference);
  } catch (err) {
    return {
      outcome: "error",
      error: err instanceof Error ? err.message : "Stripe retrieve failed",
    };
  }

  if (status.status !== "paid") {
    return { outcome: "not_paid_yet" };
  }

  const settle: SettleResult = await settlePaidOrder(supabase, {
    orderId: order.id,
    expectedTotalCents: order.total_cents,
    providerPaymentId: status.providerPaymentId,
    amountCents: status.amountCents,
  });

  return settle;
}
