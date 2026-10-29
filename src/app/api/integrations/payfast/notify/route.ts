import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payfastProvider } from "@/lib/payments/payfast";
import { settlePaidOrder } from "@/lib/ticketing/settle";
import { releaseTicketHolds } from "@/services/ticketing";

// POST /api/integrations/payfast/notify
//
// PayFast posts here server-to-server after a buyer pays (or
// cancels) on its hosted page. The webhook is the source of truth
// for an order's payment status — never the buyer's return URL.
//
// Verification: payfastProvider.verifyWebhook checks the ITN
// signature AND postbacks the payload to PayFast for confirmation.
// Either failure throws.
//
// Behaviour:
//  - signature/postback fail → log + return 200 (PayFast doesn't
//    act on response codes; we just don't fulfil).
//  - status = paid → settlePaidOrder (idempotent via the eq("status",
//    "pending") guard); on first transition it fulfils the order.
//  - status = cancelled/failed → cancel the pending order and
//    release its inventory hold.

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = request.headers;
  const sourceIp =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null;

  let result;
  try {
    result = await payfastProvider.verifyWebhook({
      rawBody,
      headers,
      sourceIp,
    });
  } catch (e) {
    // Verification failed — bad signature, failed postback, or
    // missing m_payment_id. Log and ack so PayFast doesn't retry
    // into the void; do NOT fulfil.
    console.error(
      "[payfast/notify] verification failed:",
      e instanceof Error ? e.message : e
    );
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
      "[payfast/notify] order not found:",
      result.orderId,
      orderErr?.message
    );
    return new NextResponse("ok", { status: 200 });
  }

  // Defense-in-depth: PayFast posts amount_gross — compare to what
  // we expect on the order. A mismatch means someone is messing
  // with the redirect / posting forged ITNs that pass signature
  // (highly unlikely with passphrase, but cheap to check).
  if (
    result.amountCents != null &&
    Math.abs(result.amountCents - order.total_cents) > 0
  ) {
    console.error(
      "[payfast/notify] amount mismatch for order",
      order.id,
      "expected",
      order.total_cents,
      "got",
      result.amountCents
    );
    return new NextResponse("ok", { status: 200 });
  }

  if (result.status === "paid") {
    // Shared settle path (same as Stripe): idempotent pending → paid,
    // seats re-taken if the window had closed, then fulfilment. A
    // replayed ITN returns "already" and is skipped. Errors aren't
    // surfaced to PayFast — the order is paid; staff handle a failed
    // fulfilment out-of-band.
    const settle = await settlePaidOrder(supabase, {
      orderId: order.id,
      expectedTotalCents: order.total_cents,
      providerPaymentId: result.providerPaymentId,
      amountCents: result.amountCents,
    });
    if (settle.outcome === "error") {
      console.error(
        "[payfast/notify] settle failed for order",
        order.id,
        settle.error
      );
    }
  } else if (result.status === "cancelled" || result.status === "failed") {
    // Cancel + release inventory only if the order is still pending
    // (don't reverse a paid order on a stray late ITN).
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
      // Give the seats back now rather than at the next sweep.
      await releaseTicketHolds(supabase, { orderId: order.id });
    }
  }
  // status === "pending" → no-op (PayFast confirming receipt).

  return new NextResponse("ok", { status: 200 });
}
