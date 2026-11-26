import { describe, expect, it } from "vitest";
import { priceCart, type PricedCart } from "../cart";
import {
  checkCoupon,
  COUPON_ERRORS,
  couponDiscount,
  couponWriteError,
  describeDiscount,
  lockedChange,
  normaliseCouponCode,
  normaliseCouponInput,
  PROVIDER_MIN_CENTS,
  providerCanCharge,
  type StoreCoupon,
} from "../coupons";
import { formatZar } from "../money";
import { catalogue, IDS } from "../testing/fixtures";

// Made-up codes only. Never real complimentary codes.
const coupon = (over: Partial<StoreCoupon> = {}): StoreCoupon => ({
  id: "c1",
  code: "WELCOME20",
  description: null,
  percent_off: 20,
  amount_off_cents: null,
  product_id: null,
  max_uses: null,
  used_count: 0,
  expires_at: null,
  active: true,
  ...over,
});

function cart(lines: Parameters<typeof priceCart>[0]["lines"]): PricedCart {
  const r = priceCart({ lines, fulfilment: "collect" }, catalogue);
  if (!r.ok) throw new Error(r.error);
  return r.cart;
}

const reviewOnly = () => cart([{ productId: IDS.review, quantity: 1, purpose: "self" }]); // R150
const reviewAndTees = () =>
  cart([
    { productId: IDS.review, quantity: 1, purpose: "self" },
    { productId: IDS.tee, variantId: IDS.teeM, quantity: 2, purpose: "self" },
  ]); // R150 + 2 × R250 = R650

describe("coupon arithmetic", () => {
  it("percent off the whole merchandise subtotal, floored to the cent", () => {
    expect(couponDiscount(coupon({ percent_off: 20 }), reviewAndTees()).discountCents).toBe(13000);
    const odd = { ...reviewOnly(), lines: [{ ...reviewOnly().lines[0], lineTotalCents: 999 }], subtotalCents: 999 };
    expect(couponDiscount(coupon({ percent_off: 33 }), odd).discountCents).toBe(329); // 329.67 → 329
  });

  it("amount off, never more than what it applies to", () => {
    expect(couponDiscount(coupon({ percent_off: null, amount_off_cents: 5000 }), reviewOnly()).discountCents).toBe(5000);
    expect(couponDiscount(coupon({ percent_off: null, amount_off_cents: 999_999 }), reviewOnly()).discountCents).toBe(15000);
  });

  it("product-scoped: only that product's lines count", () => {
    const teeOnly = coupon({ percent_off: 50, product_id: IDS.tee });
    expect(couponDiscount(teeOnly, reviewAndTees())).toEqual({ eligibleCents: 50000, discountCents: 25000 });
    const teeAmount = coupon({ percent_off: null, amount_off_cents: 80000, product_id: IDS.tee });
    expect(couponDiscount(teeAmount, reviewAndTees()).discountCents).toBe(50000); // capped at the tees, not the cart
    const all = coupon({ percent_off: 50 });
    expect(couponDiscount(all, reviewAndTees()).discountCents).toBe(32500);
  });

  it("never touches delivery: 100% off a cart with delivery leaves the delivery to pay", () => {
    const withDelivery = { ...reviewAndTees(), deliveryCents: 9900, totalCents: 65000 + 9900 };
    const r = checkCoupon(coupon({ percent_off: 100 }), withDelivery);
    expect(r).toMatchObject({ ok: true, discountCents: 65000, totalCents: 9900 });
    expect(r.ok && r.summary).toBe(`WELCOME20: Free. You save ${formatZar(65000)}.`);
  });

  it("100% on a digital-only cart is R0", () => {
    const r = checkCoupon(coupon({ code: "FREEGIFT", percent_off: 100 }), reviewOnly());
    expect(r).toMatchObject({ ok: true, discountCents: 15000, totalCents: 0 });
    expect(r.ok && r.summary).toBe("FREEGIFT: Free. There's nothing to pay.");
  });

  it("describes what a code does", () => {
    expect(describeDiscount({ percent_off: 20, amount_off_cents: null })).toBe("20% off");
    expect(describeDiscount({ percent_off: 100, amount_off_cents: null })).toBe("Free");
    expect(describeDiscount({ percent_off: null, amount_off_cents: 5000 })).toBe(`${formatZar(5000)} off`);
  });
});

describe("coupon checks", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const refused = (c: StoreCoupon | null, on = reviewOnly()) => {
    const r = checkCoupon(c, on, now);
    return r.ok ? null : r;
  };

  it("unknown, off, expired, used up and wrong product each have their own calm line", () => {
    expect(refused(null)).toEqual({ ok: false, reason: "unknown", error: COUPON_ERRORS.unknown });
    expect(refused(coupon({ active: false }))?.reason).toBe("inactive");
    expect(refused(coupon({ expires_at: "2026-11-26T09:59:59Z" }))?.reason).toBe("expired");
    expect(refused(coupon({ max_uses: 3, used_count: 3 }))?.reason).toBe("used_up");
    expect(refused(coupon({ product_id: IDS.tee }))?.reason).toBe("wrong_product");
    expect(checkCoupon(coupon({ expires_at: "2026-11-27T00:00:00Z", max_uses: 3, used_count: 2 }), reviewOnly(), now).ok).toBe(true);
    for (const line of Object.values(COUPON_ERRORS)) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/\b[A-Z]{4,}\b/); // no shouting (WELCOME20 is a code, not a word)
    }
  });

  it("codes are trimmed and upper-cased; anything else isn't a code", () => {
    expect(normaliseCouponCode("  welcome20 ")).toBe("WELCOME20");
    expect(normaliseCouponCode("friend-100")).toBe("FRIEND-100");
    for (const bad of ["", "AB", "no good!", "A--B", "-ABC", "ABC-", "A".repeat(41), 42, null]) {
      expect(normaliseCouponCode(bad)).toBeNull();
    }
  });

  it("card providers have a floor; R0 never goes to one", () => {
    expect(providerCanCharge("payfast", PROVIDER_MIN_CENTS.payfast)).toBe(true);
    expect(providerCanCharge("payfast", PROVIDER_MIN_CENTS.payfast - 1)).toBe(false);
    expect(providerCanCharge("stripe", 0)).toBe(false);
    expect(providerCanCharge("payfast", 0)).toBe(false);
  });
});

describe("staff coupon input", () => {
  const base = { code: " welcome20 ", discount_type: "percent", percent_off: 20 };

  it("normalises the code and keeps exactly one discount", () => {
    const r = normaliseCouponInput({ ...base, amount_off_cents: 5000 });
    expect(r).toEqual({
      ok: true,
      row: { code: "WELCOME20", description: null, percent_off: 20, amount_off_cents: null, product_id: null, max_uses: null, expires_at: null, active: true },
    });
    const amount = normaliseCouponInput({ code: "FRIEND-100", discount_type: "amount", amount_off_cents: 10000, percent_off: 50 });
    expect(amount.ok && amount.row).toMatchObject({ percent_off: null, amount_off_cents: 10000 });
  });

  it("refuses a bad code, a missing or out-of-range discount, and a bad date", () => {
    expect(normaliseCouponInput({ ...base, code: "no good!" }).ok).toBe(false);
    expect(normaliseCouponInput({ code: "WELCOME20", discount_type: "percent" }).ok).toBe(false);
    expect(normaliseCouponInput({ ...base, percent_off: 101 }).ok).toBe(false);
    expect(normaliseCouponInput({ code: "WELCOME20", discount_type: "amount", amount_off_cents: 0 }).ok).toBe(false);
    expect(normaliseCouponInput({ ...base, max_uses: 0 }).ok).toBe(false);
    expect(normaliseCouponInput({ ...base, expires_at: "soon" }).ok).toBe(false);
  });

  it("once used, the code, discount and product are locked", () => {
    const used = coupon({ used_count: 1 });
    const same = { code: "WELCOME20", description: "x", percent_off: 20, amount_off_cents: null, product_id: null, max_uses: 5, expires_at: null, active: false };
    expect(lockedChange(used, same)).toBeNull();
    expect(lockedChange(used, { ...same, percent_off: 30 })).toMatch(/stay as they are/);
    expect(lockedChange(used, { ...same, code: "WELCOME30" })).toMatch(/can't be renamed/);
    expect(lockedChange(coupon(), { ...same, percent_off: 30 })).toBeNull();
  });

  it("maps database refusals to calm copy, never the raw text", () => {
    const dup = couponWriteError({ code: "23505", message: 'duplicate key value violates unique constraint "store_coupons_code_idx"' });
    expect(dup).toEqual({ status: 409, error: "Another coupon already uses that code." });
    const other = couponWriteError({ code: "42501", message: "permission denied for table store_coupons" });
    expect(other.status).toBe(500);
    expect(other.error).not.toMatch(/permission|store_coupons/);
  });
});
