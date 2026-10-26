import type { createAdminClient } from "@/lib/supabase/admin";
import { reclaimOrderInventory } from "@/services/ticketing";
import { fulfillOrder } from "./fulfillment";

type AdminClient = ReturnType<typeof createAdminClient>;

export type SettleResult =
  // Flipped pending → paid and fulfilled successfully.
  | { outcome: "settled" }
  // Order wasn't pending (already paid / cancelled) — nothing to do.
  | { outcome: "already" }
  // Paid amount didn't match the order total — did not settle.
  | { outcome: "amount_mismatch" }
  // Mark-paid or fulfilment errored.
  | { outcome: "error"; error: string };

// Single source of truth for turning a confirmed payment into a paid,
// fulfilled order. Called by the Stripe/PayFast webhooks AND by the
// reconciliation paths (thanks page + cron) so every route flips an
// order the exact same way.
//
// Idempotent: the update is guarded by `.eq("status", "pending")`, so a
// replayed webhook or a reconcile that races the webhook returns
// "already" and never double-fulfils.
export async function settlePaidOrder(
  supabase: AdminClient,
  params: {
    orderId: string;
    expectedTotalCents: number;
    providerPaymentId: string | null;
    amountCents: number | null;
    /** Statuses allowed to settle. Pay-later orders settle from "invoiced". */
    fromStatuses?: Array<"pending" | "invoiced">;
  }
): Promise<SettleResult> {
  // Defense-in-depth: the amount the provider actually captured must
  // match what we expect for this order.
  if (
    params.amountCents != null &&
    Math.abs(params.amountCents - params.expectedTotalCents) > 0
  ) {
    return { outcome: "amount_mismatch" };
  }

  const { data: updated, error: updateErr } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payment_id: params.providerPaymentId,
    })
    .eq("id", params.orderId)
    .in("status", params.fromStatuses ?? ["pending"])
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return { outcome: "error", error: updateErr.message };
  }
  if (!updated) {
    // Another path already moved it out of pending.
    return { outcome: "already" };
  }

  // Paid after its checkout window closed (a delayed webhook, or a Stripe
  // reconcile days later): the sweep may already have given its seats
  // back. The buyer has paid, so take them again — a no-op otherwise.
  const { data: fits, error: reclaimErr } = await reclaimOrderInventory(
    supabase,
    params.orderId
  );
  if (reclaimErr) {
    console.error("[settle] reclaim failed for order", params.orderId, reclaimErr.message);
  } else if (fits === false) {
    console.error(
      "[settle] order",
      params.orderId,
      "was paid after its seats were resold; the tier is now oversold"
    );
  }

  const fulfilment = await fulfillOrder(supabase, params.orderId);
  if (!fulfilment.ok) {
    return { outcome: "error", error: fulfilment.error };
  }
  return { outcome: "settled" };
}
