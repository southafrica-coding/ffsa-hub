// ============================================================
// Store — cart pricing (server-side truth)
// ============================================================
// The browser keeps a cart of {product, variant, quantity, purpose}. At
// checkout the server re-reads every product and variant and prices it
// here; nothing the client says about price, stock or totals is trusted.
// Pure: the caller loads the rows, this decides.
// ============================================================

import { z } from "zod";
import type { FulfilmentMethod, ItemPurpose, StoreProduct, StoreVariant } from "./types";

export const MAX_CART_LINES = 20;
export const MAX_PACK_CODES = 500;

const email = z.string().trim().toLowerCase().email().max(254);

export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_PACK_CODES),
  purpose: z.enum(["self", "gift", "code_pack"]).default("self"),
  giftEmail: email.nullable().optional(),
  giftMessage: z.string().trim().max(500).nullable().optional(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const checkoutSchema = z.object({
  lines: z.array(cartLineSchema).min(1, "Your cart is empty").max(MAX_CART_LINES),
  buyer: z.object({
    name: z.string().trim().min(2, "Add your name").max(120),
    email,
    phone: z.string().trim().max(30).optional().nullable(),
  }),
  // "delivery" still parses so priceCart can refuse it with a clear message.
  fulfilment: z.enum(["none", "delivery", "collect"]).default("none"),
  // Optional when a coupon brings the order to R0: the server decides that,
  // never the browser ("free" is only ever set by the server).
  paymentMethod: z.enum(["payfast", "eft", "stripe"]).optional(),
  /** A coupon code as typed. Normalised and re-checked on the server. */
  couponCode: z
    .string()
    .max(80)
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s : null)),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type PricedLine = {
  product: StoreProduct;
  variant: StoreVariant | null;
  quantity: number;
  purpose: ItemPurpose;
  giftEmail: string | null;
  giftMessage: string | null;
  unitPriceCents: number;
  lineTotalCents: number;
  ships: boolean;
};

export type PricedCart = {
  lines: PricedLine[];
  subtotalCents: number;
  deliveryCents: number;
  totalCents: number;
  fulfilment: FulfilmentMethod;
  needsShipping: boolean;
  /** Always ["collect"] when something needs fulfilling: no delivery for now. */
  fulfilmentOptions: Array<"collect">;
};

export type PriceResult = { ok: true; cart: PricedCart } | { ok: false; error: string };

export function priceCart(
  input: {
    lines: CartLine[];
    fulfilment?: FulfilmentMethod;
    buyerEmail?: string;
  },
  catalogue: { products: StoreProduct[]; variants: StoreVariant[] }
): PriceResult {
  const products = new Map(catalogue.products.map((p) => [p.id, p]));
  const variantsByProduct = new Map<string, StoreVariant[]>();
  for (const v of catalogue.variants) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  if (input.lines.length === 0) return { ok: false, error: "Your cart is empty" };
  if (input.lines.length > MAX_CART_LINES) return { ok: false, error: "That's too many lines for one order" };

  const priced: PricedLine[] = [];
  // Stock asked for per variant across lines.
  const wanted = new Map<string, number>();

  for (const line of input.lines) {
    const product = products.get(line.productId);
    if (!product || product.status !== "published") {
      return { ok: false, error: "Something in your cart is no longer on the store" };
    }
    const active = (variantsByProduct.get(product.id) ?? []).filter((v) => v.active);
    let variant: StoreVariant | null = null;
    if (active.length > 0) {
      variant = active.find((v) => v.id === line.variantId) ?? null;
      if (!variant) return { ok: false, error: `Pick a size for ${product.title}` };
    } else if (line.variantId) {
      return { ok: false, error: `${product.title} has no sizes to pick` };
    }

    const purpose = line.purpose ?? "self";
    const readable = product.kind === "digital" || product.kind === "subscription";
    let quantity = line.quantity;

    if (purpose === "gift") {
      if (!readable || !product.allow_gift) return { ok: false, error: `${product.title} can't be sent as a gift` };
      if (!line.giftEmail) return { ok: false, error: "Add the email of the person you're giving it to" };
      if (input.buyerEmail && line.giftEmail === input.buyerEmail.toLowerCase()) {
        return { ok: false, error: "That's your own email. Buy it for yourself instead" };
      }
      quantity = 1;
    } else if (purpose === "code_pack") {
      if (!product.allow_code_packs) return { ok: false, error: `${product.title} isn't sold in code packs` };
      if (quantity < 2) return { ok: false, error: "A code pack is two codes or more" };
    } else if (!product.ships) {
      // You only need one copy of something you read.
      quantity = 1;
    }

    if (variant && variant.stock !== null && !product.is_preorder) {
      const total = (wanted.get(variant.id) ?? 0) + quantity;
      if (total > variant.stock) {
        return {
          ok: false,
          error: variant.stock === 0 ? `${product.title} (${variant.label}) is sold out` : `Only ${variant.stock} left of ${product.title} (${variant.label})`,
        };
      }
      wanted.set(variant.id, total);
    }

    const unit = variant?.price_cents ?? product.price_cents;
    priced.push({
      product,
      variant,
      quantity,
      purpose,
      giftEmail: purpose === "gift" ? (line.giftEmail ?? null) : null,
      giftMessage: purpose === "gift" ? (line.giftMessage?.trim() || null) : null,
      unitPriceCents: unit,
      lineTotalCents: unit * quantity,
      ships: product.ships && purpose === "self",
    });
  }

  // FFSA doesn't deliver right now: anything that needs fulfilling is
  // collected at the base. Delivery is refused outright, never priced.
  const shipping = priced.filter((l) => l.ships);
  const needsShipping = shipping.length > 0;
  const options: Array<"collect"> = needsShipping ? ["collect"] : [];

  if (input.fulfilment === "delivery") {
    return { ok: false, error: "We don't deliver right now. Everything is collected at the base" };
  }
  const fulfilment: FulfilmentMethod = needsShipping ? "collect" : "none";
  const deliveryCents = 0;

  const subtotalCents = priced.reduce((s, l) => s + l.lineTotalCents, 0);
  return {
    ok: true,
    cart: {
      lines: priced,
      subtotalCents,
      deliveryCents,
      totalCents: subtotalCents + deliveryCents,
      fulfilment,
      needsShipping,
      fulfilmentOptions: options,
    },
  };
}

/** "ST-" + 6 unambiguous characters. */
export function orderReference(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `ST-${s}`;
}
