import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  reconcileStripeOrder,
  type ReconcileOrder,
} from "@/lib/ticketing/reconcile-stripe";

export const maxDuration = 60;

// GET /api/cron/reconcile-payments — runs on a Vercel cron schedule.
//
// Safety net for Stripe (international card) orders whose
// `checkout.session.completed` webhook never arrived, leaving the buyer
// charged but the order stuck "pending". We ask Stripe directly for each
// recent pending Stripe order and settle the ones it reports as paid
// (idempotent — a webhook that lands first just wins the pending guard).
//
// Auth mirrors the other crons: `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Only look back a few days: Stripe Checkout Sessions expire well
  // before this, so anything older can't flip to paid anyway, and it
  // keeps the retrieve calls bounded.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending, error } = await admin
    .from("orders")
    .select(
      "id, status, total_cents, payment_provider, provider_reference, created_at"
    )
    .eq("status", "pending")
    .eq("payment_provider", "stripe")
    .not("provider_reference", "is", null)
    .gte("created_at", since)
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let checked = 0;
  let settled = 0;
  let stillPending = 0;
  let errors = 0;

  for (const order of (pending ?? []) as ReconcileOrder[]) {
    checked += 1;
    const r = await reconcileStripeOrder(admin, order);
    if (r.outcome === "settled") {
      settled += 1;
    } else if (r.outcome === "not_paid_yet") {
      stillPending += 1;
    } else if (r.outcome === "error" || r.outcome === "amount_mismatch") {
      errors += 1;
      console.error(
        "[cron/reconcile-payments] order",
        order.id,
        r.outcome,
        r.outcome === "error" ? r.error : "",
      );
    }
  }

  return NextResponse.json({ checked, settled, stillPending, errors });
}
