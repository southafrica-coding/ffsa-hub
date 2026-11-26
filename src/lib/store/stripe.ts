// ============================================================
// Store — Stripe Checkout (international cards)
// ============================================================
// South African buyers pay with PayFast or EFT; buyers abroad pay with a
// card through Stripe's hosted Checkout. Uses the official `stripe` SDK the
// Hub already ships for event ticketing, but keeps its own webhook
// (/api/store/stripe/webhook) so ticketing behaviour never changes.
//
// Switches (all default off):
//   * STORE_PAYMENTS_ENABLED=1   checkout at all.
//   * STORE_STRIPE_ENABLED=1     this method.
//   * STRIPE_SECRET_KEY          shared with events. Test keys only, unless
//                                STORE_STRIPE_ALLOW_LIVE=1 (this PR never sets it).
//   * STORE_STRIPE_WEBHOOK_SECRET the Store endpoint's own whsec_, falling back
//                                to STRIPE_WEBHOOK_SECRET.
//
// Charges are in ZAR at the Store's one price list; Stripe converts for the
// card holder. The webhook, never the success URL, decides an order is paid,
// and it fails closed: wrong amount, wrong currency, wrong session, live
// event in test mode, or a replay never settles.
// ============================================================

import Stripe from "stripe";
import { storePaymentsEnabled } from "./flags";

// Same pin as src/lib/payments/stripe.ts so both parse the same payloads.
const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;

/** Store sessions carry this metadata so the Store webhook can ignore ticketing sessions. */
export const STORE_SESSION_TAG = "ffsa_store";

function liveAllowed(): boolean {
  return process.env.STORE_STRIPE_ALLOW_LIVE === "1";
}

function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

export function storeStripeWebhookSecret(): string | null {
  return process.env.STORE_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || null;
}

export function storeStripeAllowed(): { ok: true } | { ok: false; reason: string } {
  if (!storePaymentsEnabled()) return { ok: false, reason: "Checkout isn't open yet." };
  if (process.env.STORE_STRIPE_ENABLED !== "1") return { ok: false, reason: "International card payments aren't open yet." };
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !storeStripeWebhookSecret()) return { ok: false, reason: "International card payments aren't set up yet." };
  if ((isLiveKey(key) || process.env.STRIPE_MODE === "live") && !liveAllowed()) {
    return { ok: false, reason: "International card payments for the Store are in test mode only." };
  }
  return { ok: true };
}

let cached: { key: string; client: Stripe } | null = null;

/** The Store's Stripe client. Throws unless storeStripeAllowed() passes. */
export function storeStripeClient(): Stripe {
  const allowed = storeStripeAllowed();
  if (!allowed.ok) throw new Error(allowed.reason);
  const key = process.env.STRIPE_SECRET_KEY!;
  if (cached?.key === key) return cached.client;
  const client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, typescript: true });
  cached = { key, client };
  return client;
}

// ────────────────────────────────────────────────────────────
// Creating a session
// ────────────────────────────────────────────────────────────

type SessionsApi = Pick<Stripe["checkout"]["sessions"], "create">;

export async function createStoreStripeSession(
  sessions: SessionsApi,
  order: { id: string; reference: string; total_cents: number; buyer_email: string },
  urls: { success: string; cancel: string }
): Promise<{ id: string; url: string }> {
  if (!Number.isInteger(order.total_cents) || order.total_cents <= 0) throw new Error("Nothing to charge.");
  const session = await sessions.create(
    {
      mode: "payment",
      currency: "zar",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "zar",
            product_data: { name: `Fire & Fragrance Store ${order.reference}` },
            unit_amount: order.total_cents, // cents, as store_orders.total_cents
          },
        },
      ],
      customer_email: order.buyer_email,
      client_reference_id: order.id,
      metadata: { order_id: order.id, [STORE_SESSION_TAG]: "1" },
      payment_intent_data: { metadata: { order_id: order.id, [STORE_SESSION_TAG]: "1" } },
      success_url: urls.success,
      cancel_url: urls.cancel,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 30,
    },
    // One order, one session, even if the request is retried.
    { idempotencyKey: `store-order-${order.id}` }
  );
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return { id: session.id, url: session.url };
}

// ────────────────────────────────────────────────────────────
// Webhook
// ────────────────────────────────────────────────────────────

export type StripeWebhookOutcome =
  | "ignored-disabled"
  | "rejected"
  | "live-refused"
  | "ignored-type"
  | "not-store"
  | "duplicate"
  | "unknown-order"
  | "session-mismatch"
  | "amount-missing"
  | "amount-mismatch"
  | "currency-mismatch"
  | "not-paid"
  | "settled"
  | "already"
  | "cancelled"
  | "noop"
  | "error";

export type StripeWebhookDeps = {
  enabled: () => boolean;
  /** Throws when the signature doesn't verify. */
  constructEvent: (rawBody: string, signature: string) => Stripe.Event;
  liveAllowed?: () => boolean;
  /** Record the event id. "duplicate" when it was already recorded. */
  claimEvent: (e: { id: string; type: string; sessionId: string; orderId: string }) => Promise<"new" | "duplicate" | "error">;
  /** Forget a claim so Stripe's retry can try again after a failure. */
  releaseEvent: (id: string) => Promise<void>;
  loadOrder: (id: string) => Promise<{ id: string; status: string; total_cents: number; payment_method: string; provider_payment_id: string | null } | null>;
  settle: (orderId: string, sessionId: string) => Promise<"settled" | "already" | "error">;
  cancel: (orderId: string) => Promise<void>;
  log?: (msg: string) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID_TYPES = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const CLOSED_TYPES = new Set(["checkout.session.expired", "checkout.session.async_payment_failed"]);

/** HTTP status for an outcome: 400 for a bad signature, 500 to make Stripe retry, else 200. */
export function stripeWebhookStatus(o: StripeWebhookOutcome): number {
  if (o === "rejected") return 400;
  if (o === "error") return 500;
  return 200;
}

export async function handleStoreStripeWebhook(
  deps: StripeWebhookDeps,
  rawBody: string,
  signature: string | null
): Promise<StripeWebhookOutcome> {
  const log = deps.log ?? ((m: string) => console.error(m));
  if (!deps.enabled()) {
    log("[store/stripe] ignored: Store Stripe payments are off");
    return "ignored-disabled";
  }
  if (!signature) {
    log("[store/stripe] rejected: no stripe-signature header");
    return "rejected";
  }
  let event: Stripe.Event;
  try {
    event = deps.constructEvent(rawBody, signature);
  } catch (e) {
    log(`[store/stripe] signature verification failed: ${e instanceof Error ? e.message : "unknown"}`);
    return "rejected";
  }
  if (event.livemode && !(deps.liveAllowed ?? liveAllowed)()) {
    log(`[store/stripe] refusing live-mode event ${event.id}: Store Stripe is test-only`);
    return "live-refused";
  }
  if (!PAID_TYPES.has(event.type) && !CLOSED_TYPES.has(event.type)) return "ignored-type";

  const session = event.data.object as Stripe.Checkout.Session;
  if (session?.object !== "checkout.session") return "ignored-type";
  // Every Stripe endpoint on the account gets every event. Ticketing
  // sessions aren't ours; leave them to /api/integrations/stripe/notify.
  if (session.metadata?.[STORE_SESSION_TAG] !== "1") return "not-store";
  const orderId = session.client_reference_id || session.metadata?.order_id || "";
  if (!UUID.test(orderId)) {
    log(`[store/stripe] no order id on ${event.id}`);
    return "unknown-order";
  }

  const claim = await deps.claimEvent({ id: event.id, type: event.type, sessionId: session.id, orderId });
  if (claim === "duplicate") return "duplicate";
  if (claim === "error") return "error";

  let outcome: StripeWebhookOutcome;
  try {
    outcome = await apply(deps, log, event.type, session, orderId);
  } catch (e) {
    log(`[store/stripe] failed on ${event.id}: ${e instanceof Error ? e.message : "unknown"}`);
    outcome = "error";
  }
  // A failure is released so Stripe's retry gets a fresh go; the settle
  // itself is guarded on status = 'pending', so a retry can't pay twice.
  if (outcome === "error") await deps.releaseEvent(event.id);
  return outcome;
}

async function apply(
  deps: StripeWebhookDeps,
  log: (m: string) => void,
  type: string,
  session: Stripe.Checkout.Session,
  orderId: string
): Promise<StripeWebhookOutcome> {
  const order = await deps.loadOrder(orderId);
  if (!order || order.payment_method !== "stripe") {
    log(`[store/stripe] no Stripe store order ${orderId}`);
    return "unknown-order";
  }
  // The session must be the one checkout created for this order.
  if (!order.provider_payment_id || order.provider_payment_id !== session.id) {
    log(`[store/stripe] session ${session.id} isn't the one on order ${order.id}`);
    return "session-mismatch";
  }

  if (CLOSED_TYPES.has(type)) {
    if (order.status !== "pending") return "noop";
    await deps.cancel(order.id);
    return "cancelled";
  }

  // Fail closed on money: the amount must be there and exact, in rand.
  const amount = session.amount_total;
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    log(`[store/stripe] refusing to settle ${order.id}: no amount on the session`);
    return "amount-missing";
  }
  if (amount !== order.total_cents) {
    log(`[store/stripe] amount mismatch on ${order.id}: expected ${order.total_cents}, got ${amount}`);
    return "amount-mismatch";
  }
  if ((session.currency ?? "").toLowerCase() !== "zar") {
    log(`[store/stripe] currency mismatch on ${order.id}: expected zar, got ${session.currency ?? "none"}`);
    return "currency-mismatch";
  }
  if (session.payment_status !== "paid") return "not-paid";
  return deps.settle(order.id, session.id);
}
