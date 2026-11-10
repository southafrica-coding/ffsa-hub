// FFSA Hub — Order refunds (end-to-end).
//
// One entry point for every way an order gets money back, so the
// ledger, the order state, the tickets, the inventory and the buyer
// email can never drift apart:
//
//   method 'provider' → call Stripe / PayFast, move real money
//   method 'manual'   → staff refunded outside the Hub and are
//                       recording it (EFT orders, legacy orders,
//                       anything the provider refuses)
//
// Ordering matters. The money moves FIRST and only a successful
// (or provider-accepted) refund touches order state — a failed
// provider call leaves the order exactly as it was, with a failed
// row in order_refunds explaining why. The old flow's failure mode
// was the opposite: the Hub said "refunded" and the money never left.

import { payfastProvider } from "@/lib/payments/payfast";
import { stripeProvider } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  PaymentProvider,
  RefundOutcome,
  ProviderName,
} from "@/lib/payments/provider";
import { logActivity } from "@/services/activity-events";
import { sendRefundEmail } from "@/lib/ticketing/refund-email";
import { formatMoney } from "@/lib/currencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type RefundMethod = "provider" | "manual";

export type RefundInput = {
  orderId: string;
  /** Amount to refund in cents. Defaults to everything still outstanding. */
  amountCents?: number;
  reason?: string | null;
  method?: RefundMethod;
  /**
   * Message shown to the buyer in the refund email — e.g. why the event
   * was cancelled. Distinct from `reason` (internal + sent to the
   * provider); this is buyer-facing prose. Omitted → no such block.
   */
  cancellationMessage?: string | null;
  /** Build + return the provider request without sending it. */
  dryRun?: boolean;
};

export type RefundResult =
  | {
      ok: true;
      refundId: string | null;
      status: "succeeded" | "pending";
      amountCents: number;
      isFullRefund: boolean;
      orderStatus: string;
      emailSent: boolean;
      dryRunPreview?: unknown;
      /** Set when the money moved but the tickets could not be voided. */
      warning?: string;
    }
  | { ok: false; error: string; httpStatus: number };

const PROVIDERS: Record<ProviderName, PaymentProvider> = {
  payfast: payfastProvider,
  stripe: stripeProvider,
};

const ORDER_FIELDS =
  "id, status, total_cents, refund_cents, currency, lines, buyer_contact_id, buyer_first_name, buyer_email, event_id, payment_provider, provider_payment_id, events(id, title, brand, public_slug, status, cancellation_message, sending_identity_id, email_show_event_logo, logo_url, email_wording)";

/**
 * Sum of refunds that actually settled. Authoritative over
 * orders.refund_cents — that column is a cached projection of this,
 * and reading the ledger keeps a concurrent second refund honest.
 */
async function settledRefundCents(
  supabase: Client,
  orderId: string
): Promise<number> {
  const { data } = await supabase
    .from("order_refunds")
    .select("amount_cents")
    .eq("order_id", orderId)
    .eq("status", "succeeded");
  return (data ?? []).reduce(
    (sum: number, r: { amount_cents: number }) => sum + r.amount_cents,
    0
  );
}

export async function refundOrder(
  supabase: Client,
  userId: string,
  input: RefundInput
): Promise<RefundResult> {
  const method: RefundMethod = input.method ?? "provider";

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(ORDER_FIELDS)
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderErr || !order) {
    return { ok: false, error: "Order not found", httpStatus: 404 };
  }

  // A partially refunded order can be refunded again, up to its total.
  if (order.status !== "paid" && order.status !== "partially_refunded") {
    return {
      ok: false,
      error: `Order is ${order.status} — only paid orders can be refunded.`,
      httpStatus: 409,
    };
  }

  const alreadyRefunded = await settledRefundCents(supabase, input.orderId);
  const outstanding = order.total_cents - alreadyRefunded;
  if (outstanding <= 0) {
    return {
      ok: false,
      error: "This order has already been refunded in full.",
      httpStatus: 409,
    };
  }

  const amountCents = input.amountCents ?? outstanding;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      error: "Refund amount must be a positive whole number of cents.",
      httpStatus: 400,
    };
  }
  if (amountCents > outstanding) {
    return {
      ok: false,
      error: `Refund of ${formatMoney(amountCents, order.currency)} exceeds the ${formatMoney(outstanding, order.currency)} still outstanding on this order.`,
      httpStatus: 400,
    };
  }

  const reason = input.reason?.trim() || null;

  // ── Provider path ────────────────────────────────────────────
  let outcome: RefundOutcome | null = null;
  if (method === "provider") {
    const providerName = order.payment_provider as ProviderName | null;
    if (!providerName || !PROVIDERS[providerName]) {
      return {
        ok: false,
        error:
          "This order has no payment provider recorded — it predates automated refunds or was never paid online. Record it as a manual refund instead.",
        httpStatus: 400,
      };
    }
    if (!order.provider_payment_id) {
      return {
        ok: false,
        error: `No ${providerName} payment id is stored against this order, so it can't be refunded automatically. Refund it in ${providerName} and record it as a manual refund.`,
        httpStatus: 400,
      };
    }

    try {
      outcome = await PROVIDERS[providerName].refundPayment({
        providerPaymentId: order.provider_payment_id,
        amountCents,
        currency: order.currency ?? "ZAR",
        reason,
        // The Hub sends its own branded email — don't double up.
        notifyBuyer: false,
        orderId: order.id,
        dryRun: input.dryRun,
      });
    } catch (e) {
      // Both adapters THROW when their keys are missing from the
      // environment (loadConfig / getClient). Turn that into a normal
      // failed outcome so staff get "PayFast is not configured" instead
      // of a 500, and can fall back to recording a manual refund.
      outcome = {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error: e instanceof Error ? e.message : "The payment provider is unavailable.",
      };
    }

    // A dry run records nothing either way — but a config error still
    // needs to surface, or "Preview request" would silently show blank.
    if (input.dryRun && outcome.status === "failed") {
      return {
        ok: false,
        error: outcome.error ?? "Could not build the provider request.",
        httpStatus: 400,
      };
    }

    // Dry run: nothing was sent, so nothing is recorded.
    if (input.dryRun) {
      return {
        ok: true,
        refundId: null,
        status: "pending",
        amountCents,
        isFullRefund: amountCents >= outstanding,
        orderStatus: order.status,
        emailSent: false,
        dryRunPreview: outcome.dryRunPreview,
      };
    }

    if (outcome.status === "failed") {
      // Record the attempt so the failure is visible in history, then
      // stop. The order is untouched and still refundable.
      await supabase.from("order_refunds").insert({
        order_id: order.id,
        amount_cents: amountCents,
        reason,
        method: "provider",
        provider: providerName,
        status: "failed",
        error_message: outcome.error,
        created_by: userId,
        completed_at: new Date().toISOString(),
      });
      return {
        ok: false,
        error: outcome.error ?? "The payment provider refused the refund.",
        httpStatus: 502,
      };
    }
  }

  // ── Record the refund ────────────────────────────────────────
  const status = method === "manual" ? "succeeded" : (outcome?.status ?? "succeeded");
  const { data: refundRow, error: insertErr } = await supabase
    .from("order_refunds")
    .insert({
      order_id: order.id,
      amount_cents: amountCents,
      reason,
      method,
      provider: method === "provider" ? order.payment_provider : null,
      provider_refund_id: outcome?.providerRefundId ?? null,
      status,
      created_by: userId,
      completed_at: status === "succeeded" ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();
  if (insertErr) {
    return {
      ok: false,
      error: `The refund went through at the provider but could not be recorded: ${insertErr.message}. Check the provider before retrying.`,
      httpStatus: 500,
    };
  }

  // ── Update order state ───────────────────────────────────────
  // A PayFast refund comes back 'pending' (queued, no ITN to confirm
  // it). We still move the order now: the money is committed, and
  // leaving the order 'paid' would let staff refund it twice.
  const newRefundedTotal = alreadyRefunded + amountCents;
  const isFullRefund = newRefundedTotal >= order.total_cents;
  const orderStatus = isFullRefund ? "refunded" : "partially_refunded";

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      status: orderStatus,
      refund_cents: newRefundedTotal,
      refunded_at: isFullRefund ? new Date().toISOString() : null,
    })
    .eq("id", order.id)
    .in("status", ["paid", "partially_refunded"]);
  if (updateErr) {
    return {
      ok: false,
      error: `Refund recorded but the order could not be updated: ${updateErr.message}`,
      httpStatus: 500,
    };
  }

  // Only a full refund invalidates the tickets. A partial refund
  // (one ticket of three, a goodwill discount) leaves them scanning.
  // Void through the service role: tickets UPDATE is events.manage_attendance,
  // and a registrations or finance refunder must not leave paid tickets
  // scannable. This runs only after the provider refund (or a manual
  // record) has succeeded — the route's permission check is earlier.
  // A void failure still releases the hold and emails the buyer: the
  // money has already moved, and a 500 would invite a second refund.
  let warning: string | undefined;
  if (isFullRefund) {
    const { error: voidErr } = await createAdminClient()
      .from("tickets")
      .update({ status: "void" })
      .eq("order_id", order.id)
      .eq("event_id", order.event_id);
    if (voidErr) {
      warning = "Refunded, but tickets not voided. They may still scan.";
    }

    // Recorded on the order, so the seats come back exactly once — and
    // SECURITY DEFINER, so it works for finance staff too (the old
    // per-line release_ticket_inventory call was blocked by RLS for them).
    await supabase.rpc("release_ticket_holds", { p_order_id: order.id });
  }

  // ── Buyer email + CRM timeline (never fail the refund) ───────
  let emailSent = false;
  try {
    const result = await sendRefundEmail(supabase, {
      orderId: order.id,
      buyerFirstName: order.buyer_first_name,
      buyerEmail: order.buyer_email,
      event: order.events ?? { title: "your event" },
      eventId: order.event_id,
      contactId: order.buyer_contact_id ?? null,
      refundedCents: amountCents,
      totalRefundedCents: newRefundedTotal,
      orderTotalCents: order.total_cents,
      isFullRefund,
      currency: order.currency ?? "ZAR",
      // Prefer an explicit note from the caller (bulk refund passes one);
      // otherwise, if the event is cancelled and carries a reason, fall
      // back to it so a single-order refund on a cancelled event still
      // explains why — no matter which button triggered it.
      cancellationMessage:
        input.cancellationMessage?.trim() ||
        (order.events?.status === "cancelled"
          ? (order.events?.cancellation_message ?? null)
          : null),
    });
    emailSent = result.sent;
  } catch (e) {
    console.error("[refunds] refund email threw (non-blocking):", e);
  }

  if (order.buyer_contact_id) {
    try {
      await logActivity(supabase, {
        contact_id: order.buyer_contact_id,
        event_type: "ticket_refunded",
        related_user_id: userId,
        payload: {
          order_id: order.id,
          event_id: order.event_id,
          refund_cents: amountCents,
          total_refunded_cents: newRefundedTotal,
          method,
          partial: !isFullRefund,
        },
      });
    } catch (e) {
      console.error("[refunds] activity log threw (non-blocking):", e);
    }
  }

  return {
    ok: true,
    refundId: refundRow?.id ?? null,
    status: status as "succeeded" | "pending",
    amountCents,
    isFullRefund,
    orderStatus,
    emailSent,
    warning,
  };
}

/**
 * Re-read every still-pending refund on an order from the provider.
 *
 * PayFast accepts a refund and settles it later without ever calling
 * us back, so "pending" only becomes "succeeded" when someone asks.
 * Returns how many rows changed so the UI can say something useful.
 */
export async function syncPendingRefunds(
  supabase: Client,
  orderId: string
): Promise<{ checked: number; updated: number }> {
  const { data: pending } = await supabase
    .from("order_refunds")
    .select("id, provider, provider_refund_id")
    .eq("order_id", orderId)
    .eq("status", "pending");

  const rows = (pending ?? []) as Array<{
    id: string;
    provider: ProviderName | null;
    provider_refund_id: string | null;
  }>;

  let updated = 0;
  for (const row of rows) {
    if (!row.provider || !row.provider_refund_id) continue;
    const provider = PROVIDERS[row.provider];
    if (!provider?.fetchRefund) continue;

    let outcome: RefundOutcome;
    try {
      outcome = await provider.fetchRefund(row.provider_refund_id);
    } catch {
      // Provider unconfigured or unreachable — leave it pending.
      continue;
    }
    if (outcome.status === "pending") continue;

    await supabase
      .from("order_refunds")
      .update({
        status: outcome.status,
        error_message: outcome.error,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    updated++;

    // A refund the provider ultimately rejected must give the money
    // back on our side too, or the order stays wrongly written down.
    if (outcome.status === "failed") {
      const settled = await settledRefundCents(supabase, orderId);
      const { data: order } = await supabase
        .from("orders")
        .select("total_cents")
        .eq("id", orderId)
        .maybeSingle();
      if (order) {
        await supabase
          .from("orders")
          .update({
            refund_cents: settled,
            status:
              settled <= 0
                ? "paid"
                : settled >= order.total_cents
                  ? "refunded"
                  : "partially_refunded",
            refunded_at: settled >= order.total_cents ? new Date().toISOString() : null,
          })
          .eq("id", orderId);
      }
    }
  }

  return { checked: rows.length, updated };
}

export type RefundAllResult = {
  /** Orders that held money and were attempted. */
  attempted: number;
  /** Provider accepted the refund (includes PayFast 'pending'). */
  refunded: number;
  /** Provider refused, or the order can't be auto-refunded (e.g. EFT). */
  failed: number;
  totalRefundedCents: number;
  failures: Array<{ orderId: string; error: string }>;
  /** Set when a refund succeeded but its tickets could not be voided. */
  warning?: string;
};

/**
 * Refund every still-outstanding order on an event in one pass — the
 * "we're cancelling this event, give everyone their money back" button.
 *
 * Runs each order through refundOrder() so every guarantee still holds
 * per order (ledger row, tickets voided, inventory released, buyer
 * emailed). Orders with no auto-refundable provider (manual/EFT, missing
 * provider id) come back as failures with a clear reason so staff know to
 * refund those by hand — the bulk action never silently skips money.
 *
 * Sequential on purpose: providers rate-limit, and a burst of concurrent
 * Stripe/PayFast calls is more likely to trip a limit than to finish
 * faster at this scale.
 */
export async function refundEventOrders(
  supabase: Client,
  userId: string,
  eventId: string,
  opts?: { reason?: string | null; cancellationMessage?: string | null }
): Promise<RefundAllResult> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("event_id", eventId)
    .in("status", ["paid", "partially_refunded"])
    .order("created_at", { ascending: true });

  const rows = (orders ?? []) as Array<{ id: string }>;
  const result: RefundAllResult = {
    attempted: rows.length,
    refunded: 0,
    failed: 0,
    totalRefundedCents: 0,
    failures: [],
  };
  let ticketsNotVoided = false;

  for (const row of rows) {
    const r = await refundOrder(supabase, userId, {
      orderId: row.id,
      reason: opts?.reason ?? null,
      cancellationMessage: opts?.cancellationMessage ?? null,
      method: "provider",
    });
    if (r.ok) {
      result.refunded++;
      result.totalRefundedCents += r.amountCents;
      if (r.warning) ticketsNotVoided = true;
    } else {
      result.failed++;
      result.failures.push({ orderId: row.id, error: r.error });
    }
  }
  if (ticketsNotVoided) {
    result.warning = "Refunded, but tickets not voided. They may still scan.";
  }

  return result;
}

/** Refund history for a set of orders, newest first. */
export async function listRefundsForOrders(
  supabase: Client,
  orderIds: string[]
) {
  if (orderIds.length === 0) return { data: [] as unknown[] };
  return supabase
    .from("order_refunds")
    .select(
      "id, order_id, amount_cents, reason, method, provider, provider_refund_id, status, error_message, created_at, created_by, users:created_by(first_name, last_name)"
    )
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });
}
