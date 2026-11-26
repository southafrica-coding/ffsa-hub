import { describe, expect, it } from "vitest";
import { orderReference, priceCart } from "../cart";
import { ADDRESS, catalogue, IDS } from "../testing/fixtures";

const line = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, quantity: 1, purpose: "self" as const, ...extra });

describe("cart pricing (server-side truth)", () => {
  it("prices a digital product at catalogue price, one copy however many are asked for", () => {
    const r = priceCart({ lines: [line(IDS.review, { quantity: 7 })] }, catalogue);
    expect(r.ok && r.cart.totalCents).toBe(15000);
    expect(r.ok && r.cart.lines[0].quantity).toBe(1);
    expect(r.ok && r.cart.needsShipping).toBe(false);
    expect(r.ok && r.cart.fulfilment).toBe("none");
  });

  it("refuses drafts and unknown products", () => {
    expect(priceCart({ lines: [line(IDS.draft)] }, catalogue)).toEqual({ ok: false, error: "Something in your cart is no longer on the store" });
    expect(priceCart({ lines: [] }, catalogue).ok).toBe(false);
  });

  describe("merch: variants, stock, fulfilment", () => {
    it("needs a size, refuses sold-out sizes and caps at stock across lines", () => {
      expect(priceCart({ lines: [line(IDS.tee)], fulfilment: "collect" }, catalogue)).toMatchObject({ ok: false, error: "Pick a size for Example Tee" });
      expect(priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeS })], fulfilment: "collect" }, catalogue)).toMatchObject({ ok: false, error: "Example Tee (S) is sold out" });
      expect(
        priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM, quantity: 2 }), line(IDS.tee, { variantId: IDS.teeM, quantity: 2 })], fulfilment: "collect" }, catalogue)
      ).toMatchObject({ ok: false, error: "Only 3 left of Example Tee (M)" });
    });

    it("uses a variant's own price, and doesn't count untracked stock", () => {
      const r = priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeL, quantity: 40 })], fulfilment: "collect" }, catalogue);
      expect(r.ok && r.cart.totalCents).toBe(27500 * 40);
    });

    it("collect at base is free; delivery adds one fee and needs an address", () => {
      const collect = priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM, quantity: 2 })], fulfilment: "collect" }, catalogue);
      expect(collect.ok && collect.cart).toMatchObject({ fulfilment: "collect", deliveryCents: 0, totalCents: 50000, needsShipping: true });
      expect(priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM })], fulfilment: "delivery" }, catalogue)).toMatchObject({ ok: false, error: "Add a delivery address" });
      const deliver = priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM }), line(IDS.bundle)], fulfilment: "delivery", address: ADDRESS }, catalogue);
      // One parcel: the highest fee, not the sum.
      expect(deliver.ok && deliver.cart).toMatchObject({ deliveryCents: 9900, subtotalCents: 25000 + 35000, totalCents: 25000 + 35000 + 9900 });
    });

    it("must choose a method, and only one every shipping item allows", () => {
      expect(priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM })] }, catalogue)).toMatchObject({ ok: false, error: "Choose delivery or collect at base" });
      // The hoodie preorder is collect-only.
      const mixed = priceCart({ lines: [line(IDS.hoodie), line(IDS.tee, { variantId: IDS.teeM })], fulfilment: "delivery", address: ADDRESS }, catalogue);
      expect(mixed).toMatchObject({ ok: false, error: "Something in your cart is collect at base only" });
      const ok = priceCart({ lines: [line(IDS.hoodie, { quantity: 2 })], fulfilment: "collect" }, catalogue);
      expect(ok.ok && ok.cart.fulfilmentOptions).toEqual(["collect"]);
    });

    it("preorders ignore stock", () => {
      const r = priceCart({ lines: [line(IDS.hoodie, { quantity: 30 })], fulfilment: "collect" }, catalogue);
      expect(r.ok && r.cart.totalCents).toBe(55000 * 30);
    });
  });

  describe("gifts and code packs", () => {
    it("a gift is one copy to a different email, for readable products only", () => {
      const g = priceCart({ lines: [line(IDS.review, { purpose: "gift", giftEmail: "friend@example.org", quantity: 4 })], buyerEmail: "me@example.org" }, catalogue);
      expect(g.ok && g.cart.lines[0]).toMatchObject({ quantity: 1, giftEmail: "friend@example.org", ships: false });
      expect(priceCart({ lines: [line(IDS.review, { purpose: "gift" })] }, catalogue)).toMatchObject({ ok: false });
      expect(priceCart({ lines: [line(IDS.review, { purpose: "gift", giftEmail: "me@example.org" })], buyerEmail: "ME@example.org" }, catalogue)).toMatchObject({ ok: false });
      expect(priceCart({ lines: [line(IDS.tee, { variantId: IDS.teeM, purpose: "gift", giftEmail: "f@example.org" })] }, catalogue)).toMatchObject({ ok: false, error: "Example Tee can't be sent as a gift" });
    });

    it("a code pack is two or more, only where allowed, priced per code", () => {
      const p = priceCart({ lines: [line(IDS.review, { purpose: "code_pack", quantity: 25 })] }, catalogue);
      expect(p.ok && p.cart.totalCents).toBe(15000 * 25);
      expect(priceCart({ lines: [line(IDS.review, { purpose: "code_pack", quantity: 1 })] }, catalogue)).toMatchObject({ ok: false });
      expect(priceCart({ lines: [line(IDS.sub, { purpose: "code_pack", quantity: 5 })] }, catalogue)).toMatchObject({ ok: false, error: "Example Yearly isn't sold in code packs" });
    });
  });

  it("makes short, unambiguous order references", () => {
    for (let i = 0; i < 50; i++) expect(orderReference()).toMatch(/^ST-[A-HJ-NP-Z2-9]{6}$/);
  });
});
