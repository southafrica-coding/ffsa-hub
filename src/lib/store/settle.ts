// ============================================================
// Store — what a paid order turns into
// ============================================================
// planSettlement is pure: given the order's items and products it lists the
// entitlements, codes, stock takes and fulfilment row to create. The apply
// step (services/store.ts → settleStoreOrder) runs it once, behind the
// pending → paid guard, so a replayed ITN or a double "mark paid" click
// can't grant twice.
// ============================================================

import { generateCode } from "./codes";
import { entitlementShape } from "./entitlements";
import type { FulfilmentStatus, StoreOrder, StoreOrderItem, StoreProduct } from "./types";

export type SettlementPlan = {
  entitlements: Array<{
    product_id: string;
    email: string;
    user_id: string | null;
    source: "purchase";
    order_item_id: string;
    includes_pdf: boolean;
    starts_at: string;
    expires_at: string | null;
  }>;
  codes: Array<{
    code: string;
    kind: "gift" | "pack";
    product_id: string;
    order_item_id: string;
    recipient_email: string | null;
    includes_pdf: boolean;
  }>;
  stock: Array<{ variant_id: string; quantity: number }>;
  fulfilment: { method: "delivery" | "collect"; status: FulfilmentStatus } | null;
};

export function planSettlement(
  order: Pick<StoreOrder, "buyer_email" | "buyer_user_id" | "fulfilment_method">,
  items: StoreOrderItem[],
  products: StoreProduct[],
  opts: { now?: Date; makeCode?: () => string; currentEnds?: Map<string, Date> } = {}
): SettlementPlan {
  const now = opts.now ?? new Date();
  const makeCode = opts.makeCode ?? (() => generateCode());
  const byId = new Map(products.map((p) => [p.id, p]));
  const plan: SettlementPlan = { entitlements: [], codes: [], stock: [], fulfilment: null };
  const seen = new Set<string>();
  let shipsAny = false;
  let allPreorder = true;

  for (const item of items) {
    const product = byId.get(item.product_id);
    if (!product) throw new Error(`Order item ${item.id} has no product`);
    const readable = product.kind !== "physical";
    const includesPdf = product.kind === "bundle";

    if (item.purpose === "self") {
      if (readable) {
        plan.entitlements.push({
          product_id: product.id,
          email: order.buyer_email,
          user_id: order.buyer_user_id,
          source: "purchase",
          order_item_id: item.id,
          ...entitlementShape(product, now, opts.currentEnds?.get(product.id) ?? null),
        });
      }
      if (product.ships) {
        shipsAny = true;
        if (!product.is_preorder) allPreorder = false;
        if (item.variant_id && !product.is_preorder) plan.stock.push({ variant_id: item.variant_id, quantity: item.quantity });
      }
    } else if (item.purpose === "gift") {
      plan.codes.push({
        code: uniqueCode(makeCode, seen),
        kind: "gift",
        product_id: product.id,
        order_item_id: item.id,
        recipient_email: item.gift_recipient_email,
        includes_pdf: includesPdf,
      });
    } else {
      for (let i = 0; i < item.quantity; i++) {
        plan.codes.push({
          code: uniqueCode(makeCode, seen),
          kind: "pack",
          product_id: product.id,
          order_item_id: item.id,
          recipient_email: null,
          includes_pdf: includesPdf,
        });
      }
    }
  }

  if (shipsAny) {
    const method = order.fulfilment_method === "delivery" ? "delivery" : "collect";
    plan.fulfilment = { method, status: allPreorder ? "preorder" : "to_pack" };
  }
  return plan;
}

function uniqueCode(make: () => string, seen: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const c = make();
    if (!seen.has(c)) {
      seen.add(c);
      return c;
    }
  }
  throw new Error("Could not make a unique code");
}

// ── Fulfilment status moves ─────────────────────────────────
// Media moves an order forward; a buyer email goes out on each step.
const NEXT: Record<FulfilmentStatus, FulfilmentStatus[]> = {
  preorder: ["to_pack"],
  to_pack: ["shipped", "ready_to_collect"],
  ready_to_collect: ["collected"],
  shipped: ["delivered"],
  collected: [],
  delivered: [],
};

export function canMoveFulfilment(method: "delivery" | "collect", from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  if (!NEXT[from].includes(to)) return false;
  if (method === "delivery" && (to === "ready_to_collect" || to === "collected")) return false;
  if (method === "collect" && (to === "shipped" || to === "delivered")) return false;
  return true;
}

export function nextFulfilmentSteps(method: "delivery" | "collect", from: FulfilmentStatus): FulfilmentStatus[] {
  return NEXT[from].filter((to) => canMoveFulfilment(method, from, to));
}

export function fulfilmentLabel(s: FulfilmentStatus): string {
  return {
    preorder: "Preorder, waiting for stock",
    to_pack: "To pack",
    ready_to_collect: "Ready to collect",
    shipped: "Shipped",
    collected: "Collected",
    delivered: "Delivered",
  }[s];
}
