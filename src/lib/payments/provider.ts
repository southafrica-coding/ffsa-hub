// FFSA Hub — Payment provider abstraction.
//
// One interface, swappable adapters. PayFast (South African
// cards) ships in v1; Stripe (international) in v1.5. Orders,
// tickets and fulfilment stay provider-agnostic — only checkout
// creation and webhook verification differ per provider.
// See FFSA_Hub_Events_Ticketing_Spec.md §5.

export type ProviderName = "payfast" | "stripe";

/** What the checkout API hands a provider to start a payment. */
export type CheckoutRequest = {
  /** orders.id — round-trips back to us via the webhook. */
  orderId: string;
  /** Grossed-up total to charge, in ZAR cents. */
  amountCents: number;
  /** ISO 4217 currency code; "ZAR" in v1. */
  currency: string;
  /** Human-readable line, e.g. "Holy Spirit Conference — 2 tickets". */
  description: string;
  buyer: {
    firstName: string;
    lastName: string;
    email: string;
  };
  /** Buyer is sent here after a successful payment. */
  returnUrl: string;
  /** Buyer is sent here if they cancel. */
  cancelUrl: string;
  /** Server-to-server webhook / ITN target. */
  notifyUrl: string;
};

/** Where to send the buyer to pay. */
export type CheckoutResult = {
  /** Provider-hosted page to redirect the buyer to. */
  redirectUrl: string;
  /** Provider-side reference, stored on orders.provider_reference. */
  reference: string;
};

/** A provider webhook / ITN request, as handed to a provider for verification. */
export type WebhookRequest = {
  /** Raw, unparsed request body — required for signature checks. */
  rawBody: string;
  /** Request headers. */
  headers: Headers;
  /** Caller IP, where the route handler can determine it. */
  sourceIp: string | null;
};

/** Normalised, provider-independent payment state. */
export type PaymentStatus = "paid" | "cancelled" | "failed" | "pending";

/** Normalised outcome of a verified provider webhook / ITN. */
export type WebhookResult = {
  /** Our orders.id, extracted from the payload. */
  orderId: string;
  status: PaymentStatus;
  /** Provider-side payment id → orders.provider_payment_id. */
  providerPaymentId: string | null;
  /** Gross amount the provider reports (ZAR cents) for an amount-match check. */
  amountCents: number | null;
};

/** What the refund API hands a provider to move money back. */
export type RefundRequest = {
  /** Provider-side payment id — orders.provider_payment_id. */
  providerPaymentId: string;
  /** Amount to return, in ZAR cents. May be less than the order total. */
  amountCents: number;
  /** ISO 4217 currency code; must match the original payment. */
  currency: string;
  /** Free-text staff reason. Providers with a fixed reason enum map it. */
  reason: string | null;
  /**
   * Ask the PROVIDER to email the buyer. The Hub sends its own
   * branded refund email, so this is normally false — set it only
   * if we ever want the provider's notice instead of ours.
   */
  notifyBuyer: boolean;
  /** Our orders.id, attached as provider-side metadata for reconciliation. */
  orderId: string;
  /**
   * Build and return the exact request WITHOUT sending it. PayFast
   * refunds cannot be exercised in sandbox, so this is the only way
   * to inspect a signed payload before it touches real money.
   */
  dryRun?: boolean;
};

/** Normalised, provider-independent refund state. */
export type RefundStatus = "succeeded" | "pending" | "failed";

/** Normalised outcome of a refund attempt. */
export type RefundOutcome = {
  status: RefundStatus;
  /** Provider-side refund id → order_refunds.provider_refund_id. */
  providerRefundId: string | null;
  /** Amount the provider reports refunding (cents), when it returns one. */
  amountCents: number | null;
  /** Populated when status is "failed" — safe to show to staff. */
  error: string | null;
  /** Only present when the request was a dryRun: what would have been sent. */
  dryRunPreview?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
};

export interface PaymentProvider {
  readonly name: ProviderName;

  /** Create a hosted-checkout session; returns where to send the buyer. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Refund a settled payment, in full or in part.
   *
   * Does NOT throw for a provider-side refusal (payment too old, wrong
   * payment method, insufficient merchant balance) — those come back as
   * `{ status: "failed", error }` so the caller can leave the order paid
   * and show staff why. Throws only for programmer/config errors.
   */
  refundPayment(req: RefundRequest): Promise<RefundOutcome>;

  /**
   * Re-read a refund the provider has already accepted. Only implemented
   * where refunds settle asynchronously (PayFast); Stripe card refunds
   * resolve on the create call.
   */
  fetchRefund?(providerRefundId: string): Promise<RefundOutcome>;

  /**
   * Verify an incoming webhook / ITN and return a normalised result.
   * THROWS if verification fails (bad signature, failed postback,
   * untrusted source) — callers must treat a throw as "reject, do
   * not fulfil the order".
   */
  verifyWebhook(req: WebhookRequest): Promise<WebhookResult>;
}
