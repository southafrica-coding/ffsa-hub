// FFSA Hub — Stripe payment provider (international cards, AmEx, wallets).
//
// Implements the PaymentProvider interface. We use Stripe Checkout
// (hosted) for shape-parity with PayFast: server creates a session,
// buyer is redirected to checkout.stripe.com, the source of truth
// is the server-to-server webhook (checkout.session.completed).
//
// Env:
//   STRIPE_SECRET_KEY      sk_live_... | sk_test_...
//   STRIPE_WEBHOOK_SECRET  whsec_...   (from Stripe Dashboard → Webhooks)
//   STRIPE_MODE            "test" | "live"  (optional; only used for logs)

import Stripe from "stripe";
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  PaymentStatus,
  RefundOutcome,
  RefundRequest,
  WebhookRequest,
  WebhookResult,
} from "./provider";

type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  mode: "test" | "live";
};

let cached: { client: Stripe; cfg: StripeConfig } | null = null;

function loadConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) {
    throw new Error(
      "Stripe is not configured — set STRIPE_SECRET_KEY in the environment."
    );
  }
  if (!webhookSecret) {
    throw new Error(
      "Stripe is not configured — set STRIPE_WEBHOOK_SECRET in the environment."
    );
  }
  return {
    secretKey,
    webhookSecret,
    mode: process.env.STRIPE_MODE === "live" ? "live" : "test",
  };
}

function getClient(): { client: Stripe; cfg: StripeConfig } {
  if (cached) return cached;
  const cfg = loadConfig();
  const client = new Stripe(cfg.secretKey, {
    // Pin the API version at build time so a Stripe-side default
    // change doesn't silently alter webhook payload shape.
    apiVersion: "2026-05-27.dahlia",
    typescript: true,
  });
  cached = { client, cfg };
  return cached;
}

// Stripe permits a 5-min tolerance window between the webhook
// signature timestamp and now. We keep the SDK default.
const WEBHOOK_TOLERANCE_SECONDS = 300;

function mapStatus(event: Stripe.Event): PaymentStatus {
  switch (event.type) {
    case "checkout.session.completed":
      return "paid";
    case "checkout.session.async_payment_succeeded":
      return "paid";
    case "checkout.session.expired":
      return "cancelled";
    case "checkout.session.async_payment_failed":
      return "failed";
    default:
      return "pending";
  }
}

// Stripe refund.status → our normalised RefundStatus. "requires_action"
// only appears for a handful of non-card methods; treat it as pending so
// staff see "awaiting confirmation" rather than a false success.
function mapRefundStatus(raw: string | null): "succeeded" | "pending" | "failed" {
  switch (raw) {
    case "succeeded":
      return "succeeded";
    case "pending":
    case "requires_action":
      return "pending";
    default:
      return "failed";
  }
}

function errText(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return err.message;
  }
  return err instanceof Error ? err.message : "Unknown Stripe error.";
}

function extractOrderId(session: Stripe.Checkout.Session | null): string | null {
  if (!session) return null;
  if (typeof session.client_reference_id === "string" && session.client_reference_id) {
    return session.client_reference_id;
  }
  const meta = session.metadata?.order_id;
  return typeof meta === "string" && meta ? meta : null;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const { client } = getClient();

    const session = await client.checkout.sessions.create({
      mode: "payment",
      // Stripe accepts USD/EUR/GBP/ZAR/etc. ZAR keeps prices identical
      // to the PayFast flow.
      currency: req.currency.toLowerCase(),
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: req.currency.toLowerCase(),
            product_data: {
              name: req.description.slice(0, 250),
            },
            // Stripe takes the unit amount in the currency's smallest
            // unit. ZAR is 100 cents per rand — same units we already
            // use across orders.total_cents.
            unit_amount: req.amountCents,
          },
        },
      ],
      customer_email: req.buyer.email,
      // Round-trip identifier — both fields set so the webhook can
      // recover the order id regardless of which the buyer sees.
      client_reference_id: req.orderId,
      metadata: { order_id: req.orderId },
      success_url: req.returnUrl,
      cancel_url: req.cancelUrl,
      // Tighter timeout than Stripe's default (24h) so abandoned
      // inventory holds release sooner.
      expires_at: Math.floor(Date.now() / 1000) + 60 * 30,
    });

    if (!session.url) {
      throw new Error("Stripe returned no checkout URL.");
    }
    return { redirectUrl: session.url, reference: session.id };
  },

  async refundPayment(req: RefundRequest): Promise<RefundOutcome> {
    const { client } = getClient();

    // verifyWebhook stores the PaymentIntent id, but falls back to the
    // Checkout Session id when Stripe hasn't attached the intent yet.
    // Refunds only accept an intent (or charge), so recover it here.
    let paymentIntentId = req.providerPaymentId;
    if (paymentIntentId.startsWith("cs_")) {
      try {
        const session = await client.checkout.sessions.retrieve(paymentIntentId);
        const intent =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
        if (!intent) {
          return {
            status: "failed",
            providerRefundId: null,
            amountCents: null,
            error:
              "Stripe session has no payment intent — the payment may never have completed.",
          };
        }
        paymentIntentId = intent;
      } catch (err) {
        return {
          status: "failed",
          providerRefundId: null,
          amountCents: null,
          error: `Could not resolve the Stripe payment for this order: ${errText(err)}`,
        };
      }
    }

    const params: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
      amount: req.amountCents,
      // Stripe's reason is a fixed enum — staff free-text goes to
      // metadata so it survives on the Stripe side for reconciliation.
      reason: "requested_by_customer",
      metadata: {
        order_id: req.orderId,
        ...(req.reason ? { hub_reason: req.reason.slice(0, 500) } : {}),
      },
    };

    if (req.dryRun) {
      return {
        status: "pending",
        providerRefundId: null,
        amountCents: req.amountCents,
        error: null,
        dryRunPreview: {
          method: "POST",
          url: "https://api.stripe.com/v1/refunds",
          body: params,
        },
      };
    }

    try {
      const refund = await client.refunds.create(params);
      return {
        status: mapRefundStatus(refund.status),
        providerRefundId: refund.id,
        amountCents: refund.amount ?? null,
        error:
          refund.status === "failed"
            ? (refund.failure_reason ?? "Stripe reported the refund failed.")
            : null,
      };
    } catch (err) {
      // Card already refunded, charge too old, insufficient balance —
      // all arrive here. Staff-readable, and the order stays paid.
      return {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error: errText(err),
      };
    }
  },

  async verifyWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const { client, cfg } = getClient();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      throw new Error("Stripe webhook rejected: missing stripe-signature header.");
    }

    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(
        req.rawBody,
        signature,
        cfg.webhookSecret,
        WEBHOOK_TOLERANCE_SECONDS
      );
    } catch (err) {
      throw new Error(
        `Stripe webhook rejected: ${err instanceof Error ? err.message : "signature verification failed"}.`
      );
    }

    const session =
      event.data.object && (event.data.object as Stripe.Checkout.Session).object === "checkout.session"
        ? (event.data.object as Stripe.Checkout.Session)
        : null;

    const orderId = extractOrderId(session);
    if (!orderId) {
      throw new Error(
        `Stripe webhook rejected: no order id on event ${event.type}.`
      );
    }

    const amountCents =
      session?.amount_total != null ? session.amount_total : null;

    return {
      orderId,
      status: mapStatus(event),
      providerPaymentId:
        typeof session?.payment_intent === "string"
          ? session.payment_intent
          : session?.payment_intent?.id ?? session?.id ?? null,
      amountCents,
    };
  },
};
