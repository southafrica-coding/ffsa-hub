import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, storeRpcs, type MemoryDb } from "../testing/memory-db";
import { catalogue, IDS } from "../testing/fixtures";
import { listPublishedProducts } from "@/services/store";
import { thanksPath } from "../signing";
import { storeStripeClient } from "../stripe";

vi.mock("server-only", () => ({}));

// One in-memory database and one "who is signed in" per test. Both the
// request client and the service-role client point at it; the request
// client also answers auth.getUser and has_permission like Supabase would.
let db: MemoryDb;
let who: { id: string; email: string; email_confirmed_at?: string | null } | null = null;
let grants: string[] = [];

function requestClient() {
  const c = db.client;
  return {
    from: c.from,
    rpc: async (name: string, args: Record<string, unknown>) =>
      name === "has_permission" ? { data: !!who && grants.includes(String(args.required_permission)), error: null } : c.rpc(name, args),
    auth: { getUser: async () => ({ data: { user: who }, error: null }) },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => requestClient() }));
vi.mock("@/lib/store/db", () => ({ storeAdminClient: () => db.client }));
const sendTransactional = vi.hoisted(() => vi.fn(async (email: Record<string, unknown>) => ({ ok: true as const, to: email.to })));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional }));
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  const limiter = new real.InMemoryRateLimiter();
  return { ...real, getRateLimiter: () => limiter };
});

const STAFF = { id: "staff-1", email: "media@example.org" };
const BUYER = { id: "buyer-1", email: "buyer@example.org", email_confirmed_at: "2026-01-01T00:00:00Z" };

function seed() {
  db = createMemoryDb(
    {
      users: [{ id: STAFF.id, is_active: true }], // buyers have no users row
      user_roles: [{ user_id: STAFF.id, roles: { name: "staff" } }],
      store_products: catalogue.products,
      store_variants: catalogue.variants,
    },
    { rpc: storeRpcs, unique: { store_products: [["slug"]], store_stripe_events: [["event_id"]] } }
  );
}

const json = (body: unknown, method = "POST") => new Request("https://hub.test/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify(body) });

beforeEach(() => {
  seed();
  who = null;
  grants = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("catalogue as data: admin creates, storefront shows when published", () => {
  const newProduct = { title: "Example Year-End Review", kind: "digital", price_cents: 18000, status: "draft" };

  it("staff with store.manage create a draft (hidden), then publish it (shown)", async () => {
    const { POST } = await import("@/app/api/store/admin/products/route");
    const { PATCH } = await import("@/app/api/store/admin/products/[id]/route");
    who = STAFF;
    grants = ["store.manage"];

    const created = await POST(json(newProduct));
    expect(created.status).toBe(200);
    const { product } = await created.json();
    expect(product).toMatchObject({ slug: "example-year-end-review", status: "draft", price_cents: 18000, ships: false });

    const before = (await listPublishedProducts(db.client)).data as Array<{ slug: string }>;
    expect(before.map((p) => p.slug)).not.toContain("example-year-end-review");

    const published = await PATCH(json({ ...newProduct, status: "published", price_cents: 20000 }, "PATCH"), { params: Promise.resolve({ id: product.id }) });
    expect(published.status).toBe(200);
    const after = (await listPublishedProducts(db.client)).data as Array<{ slug: string; price_cents: number }>;
    expect(after.find((p) => p.slug === "example-year-end-review")?.price_cents).toBe(20000);
    expect(after.map((p) => p.slug)).not.toContain("example-draft");
  });

  it("refuses a second product with the same link name", async () => {
    const { POST } = await import("@/app/api/store/admin/products/route");
    who = STAFF;
    grants = ["store.manage"];
    expect((await POST(json({ ...newProduct, slug: "example-review" }))).status).toBe(409);
  });

  it("buyers and view-only staff can't change the catalogue; signed-out gets 401", async () => {
    const { POST } = await import("@/app/api/store/admin/products/route");
    who = null;
    expect((await POST(json(newProduct))).status).toBe(401);
    who = BUYER;
    grants = ["store.manage"]; // even a forged grant: no users row means not staff
    expect((await POST(json(newProduct))).status).toBe(403);
    who = STAFF;
    grants = ["store.view"];
    expect((await POST(json(newProduct))).status).toBe(403);
    expect(db.table("store_products").some((p) => p.title === newProduct.title)).toBe(false);
  });

  it("a buyer can't mark an EFT order paid or read the order export", async () => {
    const { POST } = await import("@/app/api/store/admin/orders/[id]/mark-paid/route");
    const { GET } = await import("@/app/api/store/admin/orders/export/route");
    who = BUYER;
    expect((await POST(json({}), { params: Promise.resolve({ id: "o1" }) })).status).toBe(403);
    expect((await GET(new Request("https://hub.test/x"))).status).toBe(403);
  });
});

describe("checkout", () => {
  function sandbox() {
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
    vi.stubEnv("PAYFAST_MERCHANT_ID", "10000100");
    vi.stubEnv("PAYFAST_MERCHANT_KEY", "46f0cd694581a");
    vi.stubEnv("PAYFAST_PASSPHRASE", "test-pass-phrase");
    vi.stubEnv("PAYFAST_MODE", "sandbox");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hub.test");
  }
  const body = (extra: Record<string, unknown> = {}) => ({
    lines: [
      { productId: IDS.review, quantity: 1, purpose: "self" },
      { productId: IDS.tee, variantId: IDS.teeM, quantity: 2, purpose: "self", unitPriceCents: 1 }, // client "price" is ignored
    ],
    buyer: { name: "Example Buyer", email: "Buyer@Example.org" },
    fulfilment: "collect",
    paymentMethod: "payfast",
    ...extra,
  });

  it("is closed while STORE_PAYMENTS_ENABLED is off", async () => {
    const { POST } = await import("@/app/api/store/checkout/route");
    const res = await POST(json(body()));
    expect(res.status).toBe(503);
    expect(db.table("store_orders")).toHaveLength(0);
  });

  it("prices on the server, saves a PENDING order and sends the buyer to the PayFast sandbox", async () => {
    sandbox();
    const { POST } = await import("@/app/api/store/checkout/route");
    const res = await POST(json(body()));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.next).toMatch(/^https:\/\/sandbox\.payfast\.co\.za\/eng\/process\?/);
    expect(out.next).toContain("amount=650.00");
    expect(out.next).toContain(encodeURIComponent("https://hub.test/api/integrations/payfast/store-notify"));
    const [order] = db.table("store_orders");
    expect(order).toMatchObject({ status: "pending", buyer_email: "buyer@example.org", total_cents: 15000 + 2 * 25000, fulfilment_method: "collect", payment_method: "payfast" });
    expect(db.table("store_order_items").map((i) => i.unit_price_cents)).toEqual([15000, 25000]);
    expect(db.table("store_entitlements")).toHaveLength(0); // nothing granted until the ITN
  });

  it("won't create an order PayFast would run live", async () => {
    sandbox();
    vi.stubEnv("PAYFAST_MODE", "live");
    const { POST } = await import("@/app/api/store/checkout/route");
    expect((await POST(json(body()))).status).toBe(503);
  });

  it("rejects a sold-out size", async () => {
    sandbox();
    const { POST } = await import("@/app/api/store/checkout/route");
    const soldOut = await POST(json(body({ lines: [{ productId: IDS.tee, variantId: IDS.teeS, quantity: 1, purpose: "self" }] })));
    expect(soldOut.status).toBe(409);
  });

  it("collection only: refuses delivery, saves a physical cart as collect with no fee or address", async () => {
    sandbox();
    const { POST } = await import("@/app/api/store/checkout/route");
    const address = { line1: "1 Example Street", city: "Exampleton", province: "North West", postal_code: "0000" };
    const delivery = await POST(json(body({ fulfilment: "delivery", address })));
    expect(delivery.status).toBe(409);
    expect((await delivery.json()).error).toBe("We don't deliver right now. Everything is collected at the base");
    expect(db.table("store_orders")).toHaveLength(0);

    // No choice needed: a physical cart sent as "none" (or with a stray address) is collect.
    const res = await POST(json(body({ fulfilment: "none", address })));
    expect(res.status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ fulfilment_method: "collect", delivery_cents: 0, delivery_address: null, total_cents: 15000 + 2 * 25000 });
  });

  it("EFT: a pending order with the bank reference, until Media marks it paid", async () => {
    sandbox();
    vi.stubEnv("STORE_EFT_BANK", "Example Bank");
    vi.stubEnv("STORE_EFT_ACCOUNT_NAME", "Example Account");
    vi.stubEnv("STORE_EFT_ACCOUNT_NUMBER", "000000000");
    vi.stubEnv("STORE_EFT_BRANCH_CODE", "000000");
    const { POST } = await import("@/app/api/store/checkout/route");
    const res = await POST(json(body({ paymentMethod: "eft", lines: [{ productId: IDS.review, quantity: 1, purpose: "self" }], fulfilment: "none" })));
    expect(res.status).toBe(200);
    const out = await res.json();
    // The thanks link carries a signed order token; the bare id opens nothing.
    expect(out.next).toBe(thanksPath(out.orderId));
    expect(out.next).toMatch(/&t=[A-Za-z0-9_-]{20,}$/);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "pending", payment_method: "eft" });

    // Media marks it paid → the buyer gets the entitlement, once.
    const markPaid = (await import("@/app/api/store/admin/orders/[id]/mark-paid/route")).POST;
    who = STAFF;
    grants = ["store.manage"];
    const paid = await markPaid(json({}), { params: Promise.resolve({ id: out.orderId }) });
    expect(paid.status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "paid", marked_paid_by: STAFF.id });
    expect(db.table("store_entitlements")).toEqual([expect.objectContaining({ email: "buyer@example.org", product_id: IDS.review, includes_pdf: false })]);
    expect((await (await markPaid(json({}), { params: Promise.resolve({ id: out.orderId }) })).json()).outcome).toBe("already");
    expect(db.table("store_entitlements")).toHaveLength(1);
  });
});

describe("quote: collection only", () => {
  const quote = async (body: unknown) => (await import("@/app/api/store/quote/route")).POST(json(body));

  it("a physical or Print + Digital cart is collect at base with no delivery fee", async () => {
    const res = await quote({ lines: [{ productId: IDS.bundle, quantity: 1, purpose: "self" }, { productId: IDS.tee, variantId: IDS.teeM, quantity: 1, purpose: "self" }] });
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q).toMatchObject({ ok: true, needsShipping: true, fulfilment: "collect", subtotalCents: 35000 + 25000, totalCents: 35000 + 25000 });
    expect(q).not.toHaveProperty("deliveryFeeCents");
    expect(q).not.toHaveProperty("fulfilmentOptions");
  });

  it("digital-only stays 'none'", async () => {
    const q = await (await quote({ lines: [{ productId: IDS.review, quantity: 1, purpose: "self" }] })).json();
    expect(q).toMatchObject({ ok: true, needsShipping: false, fulfilment: "none", totalCents: 15000 });
  });

  it("refuses delivery", async () => {
    const res = await quote({ lines: [{ productId: IDS.tee, variantId: IDS.teeM, quantity: 1, purpose: "self" }], fulfilment: "delivery" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/don't deliver/);
  });
});

describe("product admin: merch is collect at base only", () => {
  it("saves a physical product as collect, ignoring any delivery flag or fee sent", async () => {
    const { POST } = await import("@/app/api/store/admin/products/route");
    who = STAFF;
    grants = ["store.manage"];
    const res = await POST(json({ title: "Example Cap", kind: "physical", price_cents: 15000, allow_delivery: true, delivery_fee_cents: 9900 }));
    expect(res.status).toBe(200);
    expect((await res.json()).product).toMatchObject({ ships: true, allow_collect: true, allow_delivery: false, delivery_fee_cents: 0 });
  });
});

describe("ready to collect: the buyer email", () => {
  const ORDER = "11111111-1111-4111-8111-111111111111";
  function seedOrder() {
    db.table("store_orders").push({ id: ORDER, reference: "ST-READY2", buyer_email: "buyer@example.org", buyer_name: "Example Buyer", buyer_user_id: null, status: "paid", payment_method: "payfast", fulfilment_method: "collect", subtotal_cents: 25000, delivery_cents: 0, total_cents: 25000, delivery_address: null });
    db.table("store_fulfilments").push({ order_id: ORDER, method: "collect", status: "to_pack", tracking: null, notes: null });
  }
  const move = async (status: string) => (await import("@/app/api/store/admin/orders/[id]/fulfilment/route")).POST(json({ status }), { params: Promise.resolve({ id: ORDER }) });

  beforeEach(() => {
    sendTransactional.mockClear();
    seedOrder();
    who = STAFF;
    grants = ["store.manage"];
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hub.test");
  });

  it("sends the ready-to-collect email when STORE_EMAILS_ENABLED=1", async () => {
    vi.stubEnv("STORE_EMAILS_ENABLED", "1");
    const res = await move("ready_to_collect");
    expect(res.status).toBe(200);
    expect(db.table("store_fulfilments")[0]).toMatchObject({ status: "ready_to_collect", updated_by: STAFF.id });
    expect(sendTransactional).toHaveBeenCalledTimes(1);
    const sent = sendTransactional.mock.calls[0][0] as { to: string; subject: string; html: string; category: string; sourceId: string };
    expect(sent).toMatchObject({ to: "buyer@example.org", subject: "Order ST-READY2: ready to collect", category: "store_fulfilment", sourceId: ORDER });
    expect(sent.html).toContain("Your order is ready to collect");
    expect(sent.html).toContain("reception at the base");
  });

  it("skips and logs (no send) when the flag is off", async () => {
    vi.stubEnv("STORE_EMAILS_ENABLED", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await move("ready_to_collect");
    expect(res.status).toBe(200);
    expect(db.table("store_fulfilments")[0]).toMatchObject({ status: "ready_to_collect" });
    expect(sendTransactional).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("[store/email] not sent (STORE_EMAILS_ENABLED is off): store_fulfilment");
    info.mockRestore();
  });

  it("a collect order can't be marked shipped", async () => {
    vi.stubEnv("STORE_EMAILS_ENABLED", "1");
    expect((await move("shipped")).status).toBe(409);
    expect(sendTransactional).not.toHaveBeenCalled();
  });
});

describe("Stripe Checkout (international card)", () => {
  // Made-up test key and webhook secret; no network: sessions.create is stubbed.
  const KEY = "sk_test_store_route_fake";
  const WHSEC = "whsec_store_route_fake";
  function enable() {
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
    vi.stubEnv("STORE_STRIPE_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", KEY);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_events_endpoint_fake");
    vi.stubEnv("STORE_STRIPE_WEBHOOK_SECRET", WHSEC);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hub.test");
  }
  const body = { lines: [{ productId: IDS.review, quantity: 1, purpose: "self" }], buyer: { name: "Example Buyer", email: "buyer@example.org" }, fulfilment: "none", paymentMethod: "stripe" };
  const hook = (payload: string, header: string | null) =>
    new Request("https://hub.test/api/store/stripe/webhook", { method: "POST", headers: header ? { "stripe-signature": header } : {}, body: payload });

  async function checkout() {
    const create = vi.spyOn(storeStripeClient().checkout.sessions, "create").mockResolvedValue({ id: "cs_test_route_1", url: "https://checkout.stripe.com/c/pay/cs_test_route_1" } as never);
    const { POST } = await import("@/app/api/store/checkout/route");
    const res = await POST(json(body));
    return { res, create };
  }
  function completed(orderId: string, over: Record<string, unknown> = {}, id = "evt_route_1") {
    const payload = JSON.stringify({
      id, object: "event", type: "checkout.session.completed", livemode: false,
      data: { object: { id: "cs_test_route_1", object: "checkout.session", amount_total: 15000, currency: "zar", payment_status: "paid", client_reference_id: orderId, metadata: { order_id: orderId, ffsa_store: "1" }, ...over } },
    });
    return { payload, header: new Stripe(KEY).webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
  }

  it("is hidden unless STORE_STRIPE_ENABLED=1, and refuses a live key", async () => {
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
    const { POST } = await import("@/app/api/store/checkout/route");
    expect((await POST(json(body))).status).toBe(503);
    enable();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_store_route_fake");
    expect((await POST(json(body))).status).toBe(503);
    expect(db.table("store_orders")).toHaveLength(0);
  });

  it("creates a pending Stripe order pinned to its session, returns the session URL; success comes back to the signed thanks page", async () => {
    enable();
    const { res, create } = await checkout();
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.next).toBe("https://checkout.stripe.com/c/pay/cs_test_route_1");
    expect(db.table("store_orders")[0]).toMatchObject({ status: "pending", payment_method: "stripe", total_cents: 15000, provider_payment_id: "cs_test_route_1" });
    const params = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    expect(params.success_url).toBe(`https://hub.test${thanksPath(out.orderId)}`);
    expect(params.cancel_url).toBe(`https://hub.test/store/checkout?cancelled=${out.orderId}`);
    expect(params.currency).toBe("zar");
  });

  it("cancels the order when Stripe won't create a session", async () => {
    enable();
    vi.spyOn(storeStripeClient().checkout.sessions, "create").mockRejectedValue(new Error("boom"));
    const { POST } = await import("@/app/api/store/checkout/route");
    expect((await POST(json(body))).status).toBe(502);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "cancelled" });
  });

  it("webhook: settles through the Store path once, records the event, refuses a bad signature and a wrong amount", async () => {
    enable();
    const { res } = await checkout();
    const { orderId } = await res.json();
    const { POST } = await import("@/app/api/store/stripe/webhook/route");

    // Signed with the events endpoint's secret, not the Store's: rejected.
    const wrongSecret = completed(orderId);
    const forged = new Stripe(KEY).webhooks.generateTestHeaderString({ payload: wrongSecret.payload, secret: "whsec_events_endpoint_fake" });
    expect((await POST(hook(wrongSecret.payload, forged))).status).toBe(400);
    expect((await POST(hook(wrongSecret.payload, null))).status).toBe(400);

    const short = completed(orderId, { amount_total: 100 }, "evt_route_short");
    expect((await POST(hook(short.payload, short.header))).status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "pending" });
    expect(db.table("store_entitlements")).toHaveLength(0);

    const ok = completed(orderId);
    expect((await POST(hook(ok.payload, ok.header))).status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "paid", provider_payment_id: "cs_test_route_1" });
    expect(db.table("store_entitlements")).toEqual([expect.objectContaining({ email: "buyer@example.org", product_id: IDS.review })]);

    // Replay: deduped, still one entitlement.
    expect((await POST(hook(ok.payload, ok.header))).status).toBe(200);
    expect(db.table("store_entitlements")).toHaveLength(1);
    expect(db.table("store_stripe_events").map((e) => e.event_id).sort()).toEqual(["evt_route_1", "evt_route_short"]);
  });
});
