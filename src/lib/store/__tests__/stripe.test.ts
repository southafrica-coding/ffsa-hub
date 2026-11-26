import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoreStripeSession,
  handleStoreStripeWebhook,
  storeStripeAllowed,
  storeStripeClient,
  stripeWebhookStatus,
  type StripeWebhookDeps,
} from "../stripe";

// No real keys anywhere: a made-up test key and a made-up webhook secret.
// Signatures are real HMACs from the official SDK, so constructEvent is the
// genuine check, not a mock.
const FAKE_KEY = "sk_test_store_unit_fake";
const FAKE_WHSEC = "whsec_store_unit_fake";
const sdk = new Stripe(FAKE_KEY);
const ORDER = "44444444-4444-4444-8444-444444444444";
const SESSION = "cs_test_store_1";

afterEach(() => vi.unstubAllEnvs());

function enable() {
  vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
  vi.stubEnv("STORE_STRIPE_ENABLED", "1");
  vi.stubEnv("STRIPE_SECRET_KEY", FAKE_KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", FAKE_WHSEC);
  vi.stubEnv("STORE_STRIPE_ALLOW_LIVE", "");
  vi.stubEnv("STRIPE_MODE", "");
}

describe("storeStripeAllowed", () => {
  it("is off unless payments, the Stripe switch, a key and a webhook secret are all there", () => {
    expect(storeStripeAllowed().ok).toBe(false);
    enable();
    expect(storeStripeAllowed().ok).toBe(true);
    vi.stubEnv("STORE_STRIPE_ENABLED", "");
    expect(storeStripeAllowed().ok).toBe(false);
    enable();
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "");
    expect(storeStripeAllowed().ok).toBe(false);
    enable();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(storeStripeAllowed().ok).toBe(false);
    vi.stubEnv("STORE_STRIPE_WEBHOOK_SECRET", "whsec_store_only_fake");
    expect(storeStripeAllowed().ok).toBe(true);
  });

  it("refuses a live key or live mode unless STORE_STRIPE_ALLOW_LIVE=1", () => {
    enable();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_store_unit_fake");
    expect(storeStripeAllowed()).toEqual({ ok: false, reason: expect.stringMatching(/test mode only/) });
    expect(() => storeStripeClient()).toThrow(/test mode only/);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_store_unit_fake");
    expect(storeStripeAllowed().ok).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", FAKE_KEY);
    vi.stubEnv("STRIPE_MODE", "live");
    expect(storeStripeAllowed().ok).toBe(false);
    vi.stubEnv("STORE_STRIPE_ALLOW_LIVE", "1");
    expect(storeStripeAllowed().ok).toBe(true);
  });
});

describe("createStoreStripeSession", () => {
  const order = { id: ORDER, reference: "ST-AAAAAA", total_cents: 18000, buyer_email: "buyer@example.org" };
  const urls = { success: "https://hub.test/store/thanks?order=x&t=y", cancel: "https://hub.test/store/checkout?cancelled=x" };

  it("creates a hosted, card-only ZAR session for the exact order total and returns its URL", async () => {
    const create = vi.fn(async () => ({ id: SESSION, url: "https://checkout.stripe.com/c/pay/cs_test_store_1" }));
    const out = await createStoreStripeSession({ create } as never, order, urls);
    expect(out).toEqual({ id: SESSION, url: "https://checkout.stripe.com/c/pay/cs_test_store_1" });
    const [params, opts] = create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams, Stripe.RequestOptions];
    expect(params).toMatchObject({
      mode: "payment",
      currency: "zar",
      payment_method_types: ["card"],
      client_reference_id: ORDER,
      metadata: { order_id: ORDER, ffsa_store: "1" },
      success_url: urls.success,
      cancel_url: urls.cancel,
      customer_email: "buyer@example.org",
    });
    expect(params.line_items).toEqual([{ quantity: 1, price_data: { currency: "zar", product_data: { name: "Fire & Fragrance Store ST-AAAAAA" }, unit_amount: 18000 } }]);
    expect(opts).toEqual({ idempotencyKey: `store-order-${ORDER}` });
  });

  it("fails when Stripe returns no URL, and never charges zero", async () => {
    await expect(createStoreStripeSession({ create: async () => ({ id: SESSION, url: null }) } as never, order, urls)).rejects.toThrow(/no checkout URL/);
    const create = vi.fn();
    await expect(createStoreStripeSession({ create } as never, { ...order, total_cents: 0 }, urls)).rejects.toThrow(/Nothing to charge/);
    expect(create).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// Webhook
// ────────────────────────────────────────────────────────────

type SessionOver = Partial<Stripe.Checkout.Session> & Record<string, unknown>;
function event(over: { id?: string; type?: string; livemode?: boolean; session?: SessionOver } = {}) {
  return {
    id: over.id ?? "evt_store_1",
    object: "event",
    type: over.type ?? "checkout.session.completed",
    livemode: over.livemode ?? false,
    data: {
      object: {
        id: SESSION,
        object: "checkout.session",
        amount_total: 18000,
        currency: "zar",
        payment_status: "paid",
        client_reference_id: ORDER,
        metadata: { order_id: ORDER, ffsa_store: "1" },
        ...over.session,
      },
    },
  };
}
function signed(e: object, secret = FAKE_WHSEC) {
  const payload = JSON.stringify(e);
  return { payload, header: sdk.webhooks.generateTestHeaderString({ payload, secret }) };
}

function deps(over: Partial<StripeWebhookDeps> = {}) {
  const seen = new Set<string>();
  const order = { id: ORDER, status: "pending", total_cents: 18000, payment_method: "stripe", provider_payment_id: SESSION as string | null };
  const settle = vi.fn(async () => {
    if (order.status !== "pending") return "already" as const;
    order.status = "paid";
    return "settled" as const;
  });
  const cancel = vi.fn(async () => {
    order.status = "cancelled";
  });
  const releaseEvent = vi.fn(async (id: string) => {
    seen.delete(id);
  });
  const d: StripeWebhookDeps = {
    enabled: () => true,
    constructEvent: (raw, sig) => sdk.webhooks.constructEvent(raw, sig, FAKE_WHSEC) as Stripe.Event,
    liveAllowed: () => false,
    claimEvent: async (e) => {
      if (seen.has(e.id)) return "duplicate";
      seen.add(e.id);
      return "new";
    },
    releaseEvent,
    loadOrder: async (id) => (id === order.id ? { ...order } : null),
    settle,
    cancel,
    log: () => {},
    ...over,
  };
  return { d, settle, cancel, releaseEvent, order };
}

describe("Store Stripe webhook", () => {
  it("happy path: signature ok, amount and currency match → order paid once, with the session id", async () => {
    const { d, settle, order } = deps();
    const { payload, header } = signed(event());
    expect(await handleStoreStripeWebhook(d, payload, header)).toBe("settled");
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(ORDER, SESSION);
    expect(order.status).toBe("paid");
    expect(stripeWebhookStatus("settled")).toBe(200);
  });

  it("a bad or missing signature never settles and answers 400", async () => {
    const { d, settle } = deps();
    const { payload } = signed(event());
    const forged = signed(event(), "whsec_someone_else");
    expect(await handleStoreStripeWebhook(d, payload, forged.header)).toBe("rejected");
    expect(await handleStoreStripeWebhook(d, payload, null)).toBe("rejected");
    // A tampered body under a once-valid signature.
    const good = signed(event());
    const tampered = good.payload.replace('"amount_total":18000', '"amount_total":100');
    expect(await handleStoreStripeWebhook(d, tampered, good.header)).toBe("rejected");
    expect(settle).not.toHaveBeenCalled();
    expect(stripeWebhookStatus("rejected")).toBe(400);
  });

  it("a replayed event, or a second event for the same session, settles once", async () => {
    const { d, settle, order } = deps();
    const first = signed(event());
    expect(await handleStoreStripeWebhook(d, first.payload, first.header)).toBe("settled");
    expect(await handleStoreStripeWebhook(d, first.payload, first.header)).toBe("duplicate");
    const second = signed(event({ id: "evt_store_2", type: "checkout.session.async_payment_succeeded" }));
    expect(await handleStoreStripeWebhook(d, second.payload, second.header)).toBe("already");
    expect(order.status).toBe("paid");
    // The pending guard in settle answered "already" the second time: paid once.
    expect(settle).toHaveBeenCalledTimes(2);
    expect(await Promise.all(settle.mock.results.map((r) => r.value))).toEqual(["settled", "already"]);
  });

  it("fails closed on the money: wrong or missing amount, wrong currency, unpaid session", async () => {
    const cases: Array<[SessionOver, string]> = [
      [{ amount_total: 17999 }, "amount-mismatch"],
      [{ amount_total: null }, "amount-missing"],
      [{ currency: "usd" }, "currency-mismatch"],
      [{ currency: null }, "currency-mismatch"],
      [{ payment_status: "unpaid" }, "not-paid"],
    ];
    for (const [session, outcome] of cases) {
      const { d, settle, order } = deps();
      const { payload, header } = signed(event({ session }));
      expect(await handleStoreStripeWebhook(d, payload, header)).toBe(outcome);
      expect(settle).not.toHaveBeenCalled();
      expect(order.status).toBe("pending");
    }
  });

  it("only touches Store Stripe orders, and only the session checkout created", async () => {
    const cases: Array<[Parameters<typeof deps>[0], SessionOver, string]> = [
      [{}, { metadata: { order_id: ORDER } }, "not-store"], // a ticketing session
      [{}, { id: "cs_test_other" }, "session-mismatch"],
      [{ loadOrder: async () => ({ id: ORDER, status: "pending", total_cents: 18000, payment_method: "payfast", provider_payment_id: SESSION }) }, {}, "unknown-order"],
      [{ loadOrder: async () => ({ id: ORDER, status: "pending", total_cents: 18000, payment_method: "stripe", provider_payment_id: null }) }, {}, "session-mismatch"],
      [{}, { client_reference_id: "not-a-uuid", metadata: { ffsa_store: "1" } }, "unknown-order"],
    ];
    for (const [over, session, outcome] of cases) {
      const { d, settle } = deps(over);
      const { payload, header } = signed(event({ session }));
      expect(await handleStoreStripeWebhook(d, payload, header)).toBe(outcome);
      expect(settle).not.toHaveBeenCalled();
    }
  });

  it("refuses live-mode events while the Store is test-only, and does nothing while switched off", async () => {
    const live = deps();
    const a = signed(event({ livemode: true }));
    expect(await handleStoreStripeWebhook(live.d, a.payload, a.header)).toBe("live-refused");
    expect(live.settle).not.toHaveBeenCalled();

    const off = deps({ enabled: () => false });
    const b = signed(event());
    expect(await handleStoreStripeWebhook(off.d, b.payload, b.header)).toBe("ignored-disabled");
    expect(off.settle).not.toHaveBeenCalled();
  });

  it("an expired session cancels a pending order, like a PayFast cancel; other events are ignored", async () => {
    const { d, cancel, order } = deps();
    const exp = signed(event({ id: "evt_exp", type: "checkout.session.expired", session: { payment_status: "unpaid" } }));
    expect(await handleStoreStripeWebhook(d, exp.payload, exp.header)).toBe("cancelled");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(order.status).toBe("cancelled");
    const other = signed(event({ id: "evt_pi", type: "payment_intent.succeeded" }));
    expect(await handleStoreStripeWebhook(d, other.payload, other.header)).toBe("ignored-type");
  });

  it("a settle failure releases the event so Stripe's retry can settle it", async () => {
    let fail = true;
    const { d, releaseEvent, order } = deps();
    const realSettle = d.settle;
    d.settle = async (id, s) => (fail ? "error" : realSettle(id, s));
    const { payload, header } = signed(event());
    const first = await handleStoreStripeWebhook(d, payload, header);
    expect(first).toBe("error");
    expect(stripeWebhookStatus(first)).toBe(500);
    expect(releaseEvent).toHaveBeenCalledWith("evt_store_1");
    fail = false;
    expect(await handleStoreStripeWebhook(d, payload, header)).toBe("settled");
    expect(order.status).toBe("paid");
  });
});
