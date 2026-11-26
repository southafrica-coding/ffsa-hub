import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payfastProvider } from "@/lib/payments/payfast";
import { createMemoryDb, storeRpcs, storeTriggers, type MemoryDb } from "../testing/memory-db";
import { catalogue, IDS, review } from "../testing/fixtures";
import { COUPON_ERRORS } from "../coupons";
import { thanksPath } from "../signing";
import { storeStripeClient } from "../stripe";
import { formatZar } from "../money";

vi.mock("server-only", () => ({}));

// Same harness as routes.test.ts: one in-memory database per test, used by
// both the request client and the service-role client. Made-up codes,
// products and example.org emails only.
let db: MemoryDb;
let who: { id: string; email: string; email_confirmed_at?: string | null } | null = null;
let grants: string[] = [];
let couponLookupFails = false;

function requestClient() {
  const c = db.client;
  return {
    from: c.from,
    rpc: async (name: string, args: Record<string, unknown>) =>
      name === "has_permission" ? { data: !!who && grants.includes(String(args.required_permission)), error: null } : c.rpc(name, args),
    auth: { getUser: async () => ({ data: { user: who }, error: null }) },
  };
}

// A service-role client that can be told the coupon table is broken, to
// prove raw database text never reaches a response.
function adminClient() {
  const c = db.client;
  return {
    ...c,
    from: (table: string) => {
      if (couponLookupFails && table === "store_coupons") {
        const failing = { message: 'relation "public.store_coupons" does not exist', code: "42P01" };
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "maybeSingle", "single", "order"]) chain[m] = () => chain;
        chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: failing }).then(ok);
        return chain;
      }
      return c.from(table);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => requestClient() }));
const storeAdminRef = vi.hoisted(() => ({ missing: false }));
vi.mock("@/lib/store/db", () => ({
  storeAdminClient: () => {
    if (storeAdminRef.missing) throw new Error("Missing Supabase admin environment variables");
    return adminClient();
  },
}));
const sendTransactional = vi.hoisted(() => vi.fn(async (email: Record<string, unknown>) => ({ ok: true as const, to: email.to })));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional }));
const limiterRef = vi.hoisted(() => ({ current: null as null | { reset: () => void } }));
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  let limiter = new real.InMemoryRateLimiter();
  limiterRef.current = { reset: () => (limiter = new real.InMemoryRateLimiter()) };
  return { ...real, getRateLimiter: () => limiter };
});

const STAFF = { id: "staff-1", email: "media@example.org" };
const BUYER = { id: "buyer-1", email: "buyer@example.org", email_confirmed_at: "2026-01-01T00:00:00Z" };
const FREEBIE = { ...review, id: "00000000-0000-4000-8000-0000000000f0", slug: "example-free-sample", title: "Example Free Sample", price_cents: 0 };

const COUPON_BASE = { description: null, amount_off_cents: null, percent_off: null, product_id: null, max_uses: null, used_count: 0, expires_at: null, active: true, created_at: "2026-11-01T00:00:00Z" };
const COUPONS = [
  { ...COUPON_BASE, id: "c-welcome", code: "WELCOME20", percent_off: 20 },
  { ...COUPON_BASE, id: "c-free", code: "FREEGIFT", percent_off: 100 },
  { ...COUPON_BASE, id: "c-solo", code: "LASTONE", percent_off: 100, max_uses: 1 },
  { ...COUPON_BASE, id: "c-tee", code: "TEE-50", amount_off_cents: 5000, product_id: IDS.tee },
  { ...COUPON_BASE, id: "c-small", code: "ALMOST", amount_off_cents: 14800 },
  { ...COUPON_BASE, id: "c-old", code: "OLDCODE", percent_off: 10, expires_at: "2020-01-01T00:00:00Z" },
  { ...COUPON_BASE, id: "c-off", code: "PAUSED", percent_off: 10, active: false },
  { ...COUPON_BASE, id: "c-gone", code: "ALLGONE", percent_off: 10, max_uses: 2, used_count: 2 },
];

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}, unique: Record<string, string[][]> = {}) {
  db = createMemoryDb(
    {
      users: [{ id: STAFF.id, is_active: true }],
      user_roles: [{ user_id: STAFF.id, roles: { name: "staff" } }],
      store_products: [...catalogue.products, FREEBIE],
      store_variants: catalogue.variants,
      store_coupons: COUPONS,
      ...extra,
    },
    { rpc: storeRpcs, triggers: storeTriggers, unique: { store_coupons: [["code"]], store_coupon_redemptions: [["order_id"]], store_stripe_events: [["event_id"]], ...unique } }
  );
}

const json = (body: unknown, method = "POST", ip = "7.7.7.7") =>
  new Request("https://hub.test/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

const coupon = (code: string) => db.table("store_coupons").find((c) => c.code === code)!;

function payments() {
  vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hub.test");
}
function sandbox() {
  payments();
  vi.stubEnv("PAYFAST_MERCHANT_ID", "10000100");
  vi.stubEnv("PAYFAST_MERCHANT_KEY", "46f0cd694581a");
  vi.stubEnv("PAYFAST_PASSPHRASE", "test-pass-phrase");
  vi.stubEnv("PAYFAST_MODE", "sandbox");
}
function stripeOn() {
  vi.stubEnv("STORE_STRIPE_ENABLED", "1");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_store_coupon_fake");
  vi.stubEnv("STORE_STRIPE_WEBHOOK_SECRET", "whsec_store_coupon_fake");
}
function eft() {
  vi.stubEnv("STORE_EFT_BANK", "Example Bank");
  vi.stubEnv("STORE_EFT_ACCOUNT_NAME", "Example Account");
  vi.stubEnv("STORE_EFT_ACCOUNT_NUMBER", "000000000");
  vi.stubEnv("STORE_EFT_BRANCH_CODE", "000000");
}

const REVIEW = { productId: IDS.review, quantity: 1, purpose: "self" };
const TEES = { productId: IDS.tee, variantId: IDS.teeM, quantity: 2, purpose: "self" };
const order = (extra: Record<string, unknown> = {}) => ({
  lines: [REVIEW],
  buyer: { name: "Example Buyer", email: "buyer@example.org" },
  fulfilment: "none",
  paymentMethod: "payfast",
  ...extra,
});

beforeEach(() => {
  seed();
  who = null;
  grants = [];
  couponLookupFails = false;
  limiterRef.current?.reset();
  sendTransactional.mockClear();
});
afterEach(() => {
    storeAdminRef.missing = false;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/store/coupon/validate", () => {
  const validate = async (code: unknown, lines: unknown[] = [REVIEW], ip?: string) =>
    (await import("@/app/api/store/coupon/validate/route")).POST(json({ code, lines }, "POST", ip));

  it("says what a code saves on this cart, normalising what was typed, and takes nothing", async () => {
    const res = await validate("  welcome20 ", [REVIEW, TEES]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      code: "WELCOME20",
      summary: `WELCOME20: 20% off. You save ${formatZar(13000)}.`,
      subtotalCents: 65000,
      deliveryCents: 0,
      discountCents: 13000,
      totalCents: 52000,
    });
    expect(coupon("WELCOME20").used_count).toBe(0);
    expect(db.table("store_coupon_redemptions")).toHaveLength(0);
  });

  it("a 100% code on a digital cart: nothing to pay", async () => {
    const out = await (await validate("FREEGIFT")).json();
    expect(out).toMatchObject({ ok: true, discountCents: 15000, totalCents: 0, summary: "FREEGIFT: Free. There's nothing to pay." });
  });

  it("each refusal has its own status and calm line", async () => {
    const cases: Array<[unknown, number, keyof typeof COUPON_ERRORS]> = [
      ["NOPE-123", 404, "unknown"],
      ["OLDCODE", 409, "expired"],
      ["PAUSED", 409, "inactive"],
      ["ALLGONE", 409, "used_up"],
      ["TEE-50", 409, "wrong_product"],
      ["no good!", 400, "malformed"],
      ["", 400, "malformed"],
      [42, 400, "malformed"],
    ];
    for (const [code, status, reason] of cases) {
      const res = await validate(code);
      expect(res.status, String(code)).toBe(status);
      expect((await res.json()).error, String(code)).toBe(COUPON_ERRORS[reason]);
    }
    expect(db.table("store_coupons").every((c) => c.used_count === COUPONS.find((x) => x.id === c.id)!.used_count)).toBe(true);
  });

  it("never shows database text", async () => {
    couponLookupFails = true;
    const res = await validate("WELCOME20");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/relation|store_coupons|42P01/);
    expect(JSON.parse(text).error).toBe("We couldn't check that code just now. Try again.");
  });

  it("is rate-limited per IP", async () => {
    const vi_ = vi.spyOn(console, "error").mockImplementation(() => {});
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await validate(`GUESS-${i}`, [REVIEW], "9.9.9.9")).status;
    expect(last).toBe(429);
    expect((await validate("WELCOME20", [REVIEW], "8.8.8.8")).status).toBe(200);
    vi_.mockRestore();
  });
});

describe("POST /api/store/quote with a code", () => {
  const quote = async (body: unknown) => (await (await import("@/app/api/store/quote/route")).POST(json(body))).json();

  it("returns discounted totals, recomputed on the server", async () => {
    const q = await quote({ lines: [REVIEW, TEES], couponCode: "welcome20" });
    expect(q).toMatchObject({ ok: true, subtotalCents: 65000, discountCents: 13000, totalCents: 52000, coupon: { code: "WELCOME20" }, couponError: null });
  });

  it("a code that can't be used comes back as couponError with full totals", async () => {
    const q = await quote({ lines: [REVIEW], couponCode: "TEE-50" });
    expect(q).toMatchObject({ ok: true, discountCents: 0, totalCents: 15000, coupon: null, couponError: COUPON_ERRORS.wrong_product });
  });

  it("a missing service-role env still quotes, with the code unchecked and full totals", async () => {
    storeAdminRef.missing = true;
    const q = await quote({ lines: [REVIEW, TEES], couponCode: "welcome20" });
    expect(q).toMatchObject({
      ok: true,
      subtotalCents: 65000,
      discountCents: 0,
      totalCents: 65000,
      coupon: null,
      couponError: "We couldn't check that code. Try again in a moment.",
    });
  });
});

describe("checkout with a coupon", () => {
  const checkout = async (body: unknown, ip?: string) => (await import("@/app/api/store/checkout/route")).POST(json(body, "POST", ip));

  it("R0: settles at once through the settle path, grants, mints gift and pack codes, and calls no provider", async () => {
    sandbox();
    stripeOn(); // both card providers are set up, so we can see neither is called
    vi.stubEnv("STORE_EMAILS_ENABLED", "1");
    const pf = vi.spyOn(payfastProvider, "createCheckout");
    const stripe = vi.spyOn(storeStripeClient().checkout.sessions, "create");
    const res = await checkout(
      order({
        paymentMethod: undefined,
        couponCode: "freegift",
        lines: [
          REVIEW,
          { productId: IDS.review, quantity: 1, purpose: "gift", giftEmail: "friend@example.org" },
          { productId: IDS.review, quantity: 2, purpose: "code_pack" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, free: true, next: thanksPath(out.orderId) });

    const [o] = db.table("store_orders");
    expect(o).toMatchObject({ status: "paid", payment_method: "free", subtotal_cents: 60000, discount_cents: 60000, total_cents: 0, coupon_id: "c-free" });
    expect(db.table("store_entitlements")).toEqual([expect.objectContaining({ email: "buyer@example.org", product_id: IDS.review, source: "purchase" })]);
    expect(db.table("store_codes").map((c) => c.kind).sort()).toEqual(["gift", "pack", "pack"]);
    expect(coupon("FREEGIFT").used_count).toBe(1);
    expect(db.table("store_coupon_redemptions")).toEqual([expect.objectContaining({ coupon_id: "c-free", order_id: o.id, amount_cents: 60000 })]);
    expect(pf).not.toHaveBeenCalled();
    expect(stripe).not.toHaveBeenCalled();
    const subjects = sendTransactional.mock.calls.map((c) => (c[0] as { category: string }).category);
    expect(subjects).toEqual(expect.arrayContaining(["store_order_confirmation", "store_gift"]));
    const confirmation = sendTransactional.mock.calls.find((c) => (c[0] as { category: string }).category === "store_order_confirmation")![0] as { html: string };
    expect(confirmation.html).toContain("Your code covered the whole order");
  });

  it("R0 ignores a payment method the browser sends", async () => {
    sandbox();
    const res = await checkout(order({ couponCode: "FREEGIFT", paymentMethod: "payfast" }));
    expect(res.status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ payment_method: "free", status: "paid" });
  });

  it("partial: a pending order with the reduced total, sent to PayFast for that amount", async () => {
    sandbox();
    const res = await checkout(order({ lines: [REVIEW, TEES], fulfilment: "collect", couponCode: "WELCOME20" }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.next).toMatch(/^https:\/\/sandbox\.payfast\.co\.za\/eng\/process\?/);
    expect(out.next).toContain("amount=520.00");
    expect(db.table("store_orders")[0]).toMatchObject({ status: "pending", payment_method: "payfast", subtotal_cents: 65000, discount_cents: 13000, total_cents: 52000, coupon_id: "c-welcome" });
    expect(db.table("store_entitlements")).toHaveLength(0);
    expect(coupon("WELCOME20").used_count).toBe(1); // reserved while pending
  });

  it("a product-scoped code only comes off that product", async () => {
    sandbox();
    const res = await checkout(order({ lines: [REVIEW, TEES], fulfilment: "collect", couponCode: "TEE-50" }));
    expect(res.status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ discount_cents: 5000, total_cents: 60000 });
  });

  it("'nothing to pay for' still stands without a valid code", async () => {
    sandbox();
    const res = await checkout(order({ lines: [{ productId: FREEBIE.id, quantity: 1, purpose: "self" }] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("There's nothing to pay for.");
    const bad = await checkout(order({ lines: [{ productId: FREEBIE.id, quantity: 1, purpose: "self" }], couponCode: "PAUSED" }));
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toBe(COUPON_ERRORS.inactive);
    expect(db.table("store_orders")).toHaveLength(0);
  });

  it("refuses an unusable code without making an order or taking a use", async () => {
    sandbox();
    for (const [code, reason] of [["OLDCODE", "expired"], ["ALLGONE", "used_up"], ["TEE-50", "wrong_product"], ["NOPE-123", "unknown"]] as const) {
      const res = await checkout(order({ couponCode: code }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: COUPON_ERRORS[reason], coupon: reason });
    }
    expect(db.table("store_orders")).toHaveLength(0);
    expect(coupon("ALLGONE").used_count).toBe(2);
  });

  it("a total left under the card floor isn't sent to PayFast; EFT takes it", async () => {
    sandbox();
    const card = await checkout(order({ couponCode: "ALMOST" })); // R150 - R148 = R2
    expect(card.status).toBe(409);
    expect((await card.json()).error).toBe(`Card payments start at ${formatZar(500)}. Add something to your cart to pay by card.`);
    expect(db.table("store_orders")).toHaveLength(0);
    expect(coupon("ALMOST").used_count).toBe(0);

    eft();
    const card2 = await checkout(order({ couponCode: "ALMOST" }));
    expect((await card2.json()).error).toBe(`Card payments start at ${formatZar(500)}. Pay ${formatZar(200)} by EFT instead, or add something to your cart.`);
    const res = await checkout(order({ couponCode: "ALMOST", paymentMethod: "eft" }));
    expect(res.status).toBe(200);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "pending", payment_method: "eft", total_cents: 200, discount_cents: 14800 });
  });

  it("max uses 1, two checkouts at once: one order gets it, the other is told it's used up", async () => {
    payments();
    const [a, b] = await Promise.all([
      checkout(order({ couponCode: "LASTONE", paymentMethod: undefined }), "1.1.1.1"),
      checkout(order({ couponCode: "LASTONE", paymentMethod: undefined, buyer: { name: "Second Buyer", email: "second@example.org" } }), "2.2.2.2"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error).toBe(COUPON_ERRORS.used_up);
    expect(coupon("LASTONE").used_count).toBe(1);
    expect(db.table("store_coupon_redemptions")).toHaveLength(1);
    expect(db.table("store_orders")).toEqual([expect.objectContaining({ status: "paid", payment_method: "free" })]);
    expect(db.table("store_order_items")).toHaveLength(1);
  });

  it("cancelling a pending order gives the use back", async () => {
    sandbox();
    const out = await (await checkout(order({ couponCode: "WELCOME20" }))).json();
    expect(coupon("WELCOME20").used_count).toBe(1);
    const { POST } = await import("@/app/api/store/admin/orders/[id]/cancel/route");
    who = STAFF;
    grants = ["store.manage"];
    expect((await POST(json({}), { params: Promise.resolve({ id: out.orderId }) })).status).toBe(200);
    expect(coupon("WELCOME20").used_count).toBe(0);
    expect(db.table("store_coupon_redemptions")).toHaveLength(0);
  });

  it("a card session that fails cancels the order and gives the use back", async () => {
    payments();
    stripeOn();
    vi.spyOn(storeStripeClient().checkout.sessions, "create").mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout(order({ couponCode: "WELCOME20", paymentMethod: "stripe" }));
    expect(res.status).toBe(502);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "cancelled" });
    expect(coupon("WELCOME20").used_count).toBe(0);
  });

  it("R0 that fails to settle is undone, the use given back, and the error is generic", async () => {
    // An entitlement insert that the database refuses.
    seed({ store_entitlements: [{ id: "e0", product_id: IDS.review, email: "someone@example.org", source: "staff" }] }, { store_entitlements: [["product_id"]] });
    payments();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout(order({ couponCode: "FREEGIFT", paymentMethod: undefined }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("We couldn't complete your order. Nothing was charged. Try again.");
    expect(text).not.toMatch(/duplicate|unique|constraint/);
    expect(db.table("store_orders")[0]).toMatchObject({ status: "cancelled", payment_method: "free" });
    expect(db.table("store_entitlements").map((e) => e.id)).toEqual(["e0"]);
    expect(coupon("FREEGIFT").used_count).toBe(0);
  });

  it("checkout never shows database text from the coupon lookup", async () => {
    sandbox();
    couponLookupFails = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout(order({ couponCode: "WELCOME20" }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/relation|store_coupons|42P01/);
  });
});

describe("coupon admin: store.manage only", () => {
  const create = async (body: unknown) => (await import("@/app/api/store/admin/coupons/route")).POST(json(body));
  const patch = async (id: string, body: unknown) => (await import("@/app/api/store/admin/coupons/[id]/route")).PATCH(json(body, "PATCH"), { params: Promise.resolve({ id }) });
  const newCode = { code: "autumn-25", discount_type: "percent", percent_off: 25, description: "Autumn preview" };
  const ID = (c: string) => coupon(c).id as string;

  beforeEach(() => {
    // Admin PATCH ids are checked as uuids; give the seeded codes real-looking ids.
    for (const [i, c] of db.table("store_coupons").entries()) c.id = `00000000-0000-4000-8000-0000000c00${String(i).padStart(2, "0")}`;
  });

  it("signed out 401; buyers and view-only staff can't create or toggle", async () => {
    expect((await create(newCode)).status).toBe(401);
    who = BUYER;
    grants = ["store.manage"]; // forged: no users row means not staff
    expect((await create(newCode)).status).toBe(403);
    expect((await patch(ID("WELCOME20"), { active: false })).status).toBe(403);
    who = STAFF;
    grants = ["store.view"];
    expect((await create(newCode)).status).toBe(403);
    expect((await patch(ID("WELCOME20"), { active: false })).status).toBe(403);
    expect(coupon("WELCOME20").active).toBe(true);
    expect(db.table("store_coupons").some((c) => c.code === "AUTUMN-25")).toBe(false);
  });

  it("store.manage creates (code normalised) and toggles", async () => {
    who = STAFF;
    grants = ["store.manage"];
    const res = await create(newCode);
    expect(res.status).toBe(200);
    expect((await res.json()).coupon).toMatchObject({ code: "AUTUMN-25", percent_off: 25, amount_off_cents: null, active: true });
    const off = await patch(ID("WELCOME20"), { active: false });
    expect(off.status).toBe(200);
    expect(coupon("WELCOME20")).toMatchObject({ active: false, percent_off: 20 });
  });

  it("a duplicate code is a calm 409, never the database text", async () => {
    who = STAFF;
    grants = ["store.manage"];
    const res = await create({ ...newCode, code: "welcome20" });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("Another coupon already uses that code.");
    expect(text).not.toMatch(/duplicate key|constraint/);
  });

  it("a used code keeps its discount; max uses can't drop below uses", async () => {
    who = STAFF;
    grants = ["store.manage"];
    const id = ID("ALLGONE"); // used twice
    const form = { code: "ALLGONE", discount_type: "percent", percent_off: 10, max_uses: 2 };
    expect((await patch(id, { ...form, percent_off: 50 })).status).toBe(409);
    expect((await patch(id, { ...form, max_uses: 1 })).status).toBe(409);
    const ok = await patch(id, { ...form, max_uses: 10, description: "Raised for the launch week" });
    expect(ok.status).toBe(200);
    expect(coupon("ALLGONE")).toMatchObject({ max_uses: 10, percent_off: 10, description: "Raised for the launch week" });
  });

  it("bad input is a 400 with a plain reason", async () => {
    who = STAFF;
    grants = ["store.manage"];
    const res = await create({ code: "WELCOME 20!", discount_type: "percent", percent_off: 20 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Codes are 3 to 40 letters and numbers/);
  });
});
