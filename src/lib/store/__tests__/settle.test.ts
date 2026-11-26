import { describe, expect, it } from "vitest";
import { generateCode } from "../codes";
import { canMoveFulfilment, nextFulfilmentSteps, planSettlement } from "../settle";
import { createMemoryDb, storeRpcs } from "../testing/memory-db";
import { catalogue, IDS } from "../testing/fixtures";
import { settleStoreOrder } from "@/services/store";
import type { StoreOrder, StoreOrderItem, StoreProduct } from "../types";

const NOW = new Date("2026-11-26T10:00:00Z");
const order = { buyer_email: "buyer@example.org", buyer_user_id: null, fulfilment_method: "none" as const };
let n = 0;
const item = (product_id: string, extra: Partial<StoreOrderItem> = {}): StoreOrderItem => ({
  id: `item-${++n}`,
  order_id: "o1",
  product_id,
  variant_id: null,
  title: "x",
  variant_label: null,
  quantity: 1,
  unit_price_cents: 100,
  purpose: "self",
  gift_recipient_email: null,
  gift_message: null,
  ...extra,
});

describe("what a paid order grants", () => {
  it("digital for me: a forever flipbook entitlement, no PDF, nothing to ship", () => {
    const plan = planSettlement(order, [item(IDS.review)], catalogue.products, { now: NOW });
    expect(plan.entitlements).toHaveLength(1);
    expect(plan.entitlements[0]).toMatchObject({ product_id: IDS.review, email: "buyer@example.org", includes_pdf: false, expires_at: null });
    expect(plan.fulfilment).toBeNull();
    expect(plan.codes).toEqual([]);
  });

  it("Print + Digital: the only entitlement with the watermarked PDF, plus a parcel", () => {
    const plan = planSettlement({ ...order, fulfilment_method: "delivery" }, [item(IDS.bundle)], catalogue.products, { now: NOW });
    expect(plan.entitlements[0].includes_pdf).toBe(true);
    expect(plan.fulfilment).toEqual({ method: "delivery", status: "to_pack" });
  });

  it("a yearly subscription runs 12 months, and renewing early extends from the current end", () => {
    const fresh = planSettlement(order, [item(IDS.sub)], catalogue.products, { now: NOW });
    expect(fresh.entitlements[0].expires_at).toBe("2027-11-26T10:00:00.000Z");
    const renew = planSettlement(order, [item(IDS.sub)], catalogue.products, { now: NOW, currentEnds: new Map([[IDS.sub, new Date("2027-03-01T00:00:00Z")]]) });
    expect(renew.entitlements[0].expires_at).toBe("2028-03-01T00:00:00.000Z");
  });

  it("gifts make one code for the recipient; packs make one code per reader; neither grants the buyer", () => {
    const plan = planSettlement(
      order,
      [item(IDS.review, { purpose: "gift", gift_recipient_email: "friend@example.org" }), item(IDS.review, { purpose: "code_pack", quantity: 5 })],
      catalogue.products,
      { now: NOW }
    );
    expect(plan.entitlements).toEqual([]);
    expect(plan.codes.filter((c) => c.kind === "gift")).toEqual([expect.objectContaining({ recipient_email: "friend@example.org", includes_pdf: false })]);
    expect(plan.codes.filter((c) => c.kind === "pack")).toHaveLength(5);
    expect(new Set(plan.codes.map((c) => c.code)).size).toBe(6);
    for (const c of plan.codes) expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("merch takes stock and goes to pack; collect vs delivery follows the order", () => {
    const plan = planSettlement({ ...order, fulfilment_method: "collect" }, [item(IDS.tee, { variant_id: IDS.teeM, quantity: 2 })], catalogue.products);
    expect(plan.stock).toEqual([{ variant_id: IDS.teeM, quantity: 2 }]);
    expect(plan.fulfilment).toEqual({ method: "collect", status: "to_pack" });
    expect(plan.entitlements).toEqual([]);
  });

  it("an all-preorder order waits as a preorder and takes no stock", () => {
    const plan = planSettlement({ ...order, fulfilment_method: "collect" }, [item(IDS.hoodie, { quantity: 3 })], catalogue.products);
    expect(plan.stock).toEqual([]);
    expect(plan.fulfilment).toEqual({ method: "collect", status: "preorder" });
  });
});

describe("fulfilment steps", () => {
  it("collect goes ready → collected; delivery goes shipped → delivered; no skipping or crossing", () => {
    expect(nextFulfilmentSteps("collect", "to_pack")).toEqual(["ready_to_collect"]);
    expect(nextFulfilmentSteps("delivery", "to_pack")).toEqual(["shipped"]);
    expect(nextFulfilmentSteps("delivery", "preorder")).toEqual(["to_pack"]);
    expect(canMoveFulfilment("collect", "ready_to_collect", "collected")).toBe(true);
    expect(canMoveFulfilment("collect", "to_pack", "shipped")).toBe(false);
    expect(canMoveFulfilment("delivery", "to_pack", "delivered")).toBe(false);
    expect(canMoveFulfilment("delivery", "delivered", "to_pack")).toBe(false);
  });
});

describe("settleStoreOrder (pending → paid, once)", () => {
  function world(stockM = 3) {
    return createMemoryDb(
      {
        store_products: catalogue.products,
        store_variants: catalogue.variants.map((v) => (v.id === IDS.teeM ? { ...v, stock: stockM } : v)),
        store_orders: [{ id: "o1", reference: "ST-AAAAAA", buyer_email: "buyer@example.org", buyer_user_id: null, status: "pending", payment_method: "eft", fulfilment_method: "collect", total_cents: 1 }],
        store_order_items: [
          { ...item(IDS.review), id: "i1", order_id: "o1" },
          { ...item(IDS.tee, { variant_id: IDS.teeM, quantity: 2 }), id: "i2", order_id: "o1" },
          { ...item(IDS.review, { purpose: "code_pack", quantity: 3 }), id: "i3", order_id: "o1" },
        ],
      },
      { rpc: storeRpcs }
    );
  }
  const planFor = (o: StoreOrder, items: StoreOrderItem[], products: StoreProduct[]) => planSettlement(o, items, products, { makeCode: () => generateCode() });

  it("grants, makes codes, takes stock and opens fulfilment — and a replay does nothing", async () => {
    const db = world();
    const first = await settleStoreOrder(db.client, { orderId: "o1", planFor });
    expect(first.outcome).toBe("settled");
    expect(db.table("store_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.table("store_entitlements")).toHaveLength(1);
    expect(db.table("store_codes")).toHaveLength(3);
    expect(db.table("store_variants").find((v) => v.id === IDS.teeM)?.stock).toBe(1);
    expect(db.table("store_fulfilments")).toEqual([expect.objectContaining({ order_id: "o1", method: "collect", status: "to_pack" })]);

    const again = await settleStoreOrder(db.client, { orderId: "o1", planFor });
    expect(again.outcome).toBe("already");
    expect(db.table("store_entitlements")).toHaveLength(1);
    expect(db.table("store_codes")).toHaveLength(3);
    expect(db.table("store_variants").find((v) => v.id === IDS.teeM)?.stock).toBe(1);
  });

  it("never sells below zero: a size that ran out is reported for Media", async () => {
    const db = world(1);
    const r = await settleStoreOrder(db.client, { orderId: "o1", planFor });
    expect(r.outcome === "settled" && r.stockShort).toEqual([IDS.teeM]);
    expect(db.table("store_variants").find((v) => v.id === IDS.teeM)?.stock).toBe(1);
  });
});
