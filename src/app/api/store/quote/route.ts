import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cartLineSchema, priceCart } from "@/lib/store/cart";
import type { StoreProduct, StoreVariant } from "@/lib/store/types";
import { getProductsByIds, listVariants } from "@/services/store";
import { NO_STORE, readJson } from "../_shared";

const schema = z.object({
  lines: z.array(cartLineSchema).max(20),
  fulfilment: z.enum(["none", "delivery", "collect"]).optional(),
  address: z.unknown().optional(),
});

// POST /api/store/quote — price a cart for display, with the same rules as
// checkout. Creates nothing. Public.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Your cart couldn't be read" }, { status: 400, headers: NO_STORE });
  const { lines } = parsed.data;
  if (lines.length === 0) return NextResponse.json({ lines: [], items: [] }, { headers: NO_STORE });

  const supabase = await createClient();
  const ids = [...new Set(lines.map((l) => l.productId))];
  const [{ data: products }, { data: variants }] = await Promise.all([getProductsByIds(supabase, ids), listVariants(supabase, ids)]);
  const catalogue = { products: (products ?? []) as StoreProduct[], variants: (variants ?? []) as StoreVariant[] };

  // Price each line alone too, so one bad line doesn't blank the whole cart.
  const items = lines.map((line) => {
    const one = priceCart({ lines: [line], fulfilment: "collect" }, catalogue);
    const product = catalogue.products.find((p) => p.id === line.productId);
    const variant = catalogue.variants.find((v) => v.id === line.variantId);
    return one.ok
      ? { ok: true, title: product!.title, kind: product!.kind, variant: variant?.label ?? null, quantity: one.cart.lines[0].quantity, unitCents: one.cart.lines[0].unitPriceCents, totalCents: one.cart.lines[0].lineTotalCents, ships: one.cart.lines[0].ships, productId: line.productId, cover: product!.cover_image_url ? `/api/store/cover/${product!.id}` : null }
      : { ok: false, title: product?.title ?? "Unavailable", error: one.error, productId: line.productId };
  });

  const whole = priceCart(
    { lines, fulfilment: parsed.data.fulfilment ?? "none", address: (parsed.data.address as never) ?? null },
    catalogue
  );
  // Fulfilment errors are expected before the buyer picks; still report options.
  const probe = priceCart({ lines, fulfilment: "collect" }, catalogue);
  const probe2 = priceCart({ lines, fulfilment: "delivery", address: { line1: "xxx", city: "xx", province: "xx", postal_code: "0000" } }, catalogue);
  const options = probe.ok ? probe.cart.fulfilmentOptions : probe2.ok ? probe2.cart.fulfilmentOptions : [];
  const needsShipping = probe.ok ? probe.cart.needsShipping : probe2.ok ? probe2.cart.needsShipping : items.some((i) => "ships" in i && i.ships);
  const deliveryFee = probe2.ok ? probe2.cart.deliveryCents : 0;

  return NextResponse.json(
    {
      items,
      ok: whole.ok,
      error: whole.ok ? null : whole.error,
      subtotalCents: whole.ok ? whole.cart.subtotalCents : items.reduce((s, i) => s + ("totalCents" in i ? (i.totalCents ?? 0) : 0), 0),
      deliveryCents: whole.ok ? whole.cart.deliveryCents : 0,
      totalCents: whole.ok ? whole.cart.totalCents : null,
      needsShipping,
      fulfilmentOptions: options,
      deliveryFeeCents: deliveryFee,
    },
    { headers: NO_STORE }
  );
}
