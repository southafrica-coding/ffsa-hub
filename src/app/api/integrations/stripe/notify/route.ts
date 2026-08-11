import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeProvider } from "@/lib/payments/stripe";
import { settlePaidOrder } from "@/lib/ticketing/settle";

// POST /api/integrations/stripe/notify
//
// Stripe posts events here server-to-server after a Checkout Session
// finishes (or expires/fails). Webhook is the source of truth for an
// order's payment status — never the buyer's return URL.
//
// Verification: stripeProvider.verifyWebhook validates the
// stripe-signature header via HMAC-SHA256 + tolerance window. A
// failure throws and we ack 200 without fulfilling.
//
// Mirrors the PayFast notify route's behaviour: paid → mark paid +
// fulfill (idempotent via the pending guard); cancelled / failed →
// cancel the pending order.

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = request.headers;
  const sourceIp =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null;

  let result;
  try {
    result = await stripeProvider.verifyWebhook({
      rawBody,
      headers,
      sourceIp,
    });
  } catch (e) {
    console.error(
      "[stripe/notify] verification failed:",
      e instanceof Error ? e.message : e
    );
    // Stripe retries on non-2xx, but a bad signature won't get better
    // by retrying. Ack with 200 to stop the retry storm; we explicitly
    // don't fulfil.
    return new NextResponse("ok", { status: 200 });
  }

  const supabase = createAdminClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, total_cents, event_id")
    .eq("id", result.orderId)
    .maybeSingle();
  if (orderErr || !order) {
    console.error(
      "[stripe/notify] order not found:",
      result.orderId,
      orderErr?.message
    );
    return new NextResponse("ok", { status: 200 });
  }

  if (result.status === "paid") {
    // Shared with the reconcile paths: amount check + idempotent
    // pending → paid + fulfilment, all in one place.
    const settle = await settlePaidOrder(supabase, {
      orderId: order.id,
      expectedTotalCents: order.total_cents,
      providerPaymentId: result.providerPaymentId,
      amountCents: result.amountCents,
    });
    if (settle.outcome === "amount_mismatch") {
      console.error(
        "[stripe/notify] amount mismatch for order",
        order.id,
        "expected",
        order.total_cents,
        "got",
        result.amountCents
      );
    } else if (settle.outcome === "error") {
      console.error(
        "[stripe/notify] settle failed for order",
        order.id,
        settle.error
      );
    }
  } else if (result.status === "cancelled" || result.status === "failed") {
    const { data: pending } = await supabase
      .from("orders")
      .select("id")
      .eq("id", order.id)
      .eq("status", "pending")
      .maybeSingle();
    if (pending) {
      await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("status", "pending");
    }
  }
  // status === "pending" → no-op (e.g. an async-payment-pending event).

  return new NextResponse("ok", { status: 200 });
}
