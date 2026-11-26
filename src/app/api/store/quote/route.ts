import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cartLineSchema, priceCart } from "@/lib/store/cart";
import { coverSrcsFor } from "@/lib/store/cover";
import { storeAdminClient } from "@/lib/store/db";
import type { StoreProduct, StoreVariant } from "@/lib/store/types";
import { getProductsByIds, listVariants } from "@/services/store";
import { NO_STORE, readJson } from "../_shared";

const schema = z.object({
  lines: z.array(cartLineSchema).max(20),
  fulfilment: z.enum(["none", "delivery", "collect"]).optional(),
});

// POST /api/store/quote — price a cart for display, with the same rules as
// checkout. Creates nothing. Public.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Your cart couldn't be read" }, { status: 400, headers: NO_STORE });
  const { lines } = parsed.data;
  if (parsed.data.fulfilment === "delivery") {
    return NextResponse.json({ error: "We don't deliver right now. Everything is collected at the base" }, { status: 400, headers: NO_STORE });
  }
  if (lines.length === 0) return NextResponse.json({ lines: [], items: [] }, { headers: NO_STORE });

  const supabase = await createClient();
  const ids = [...new Set(lines.map((l) => l.productId))];
  const [{ data: products }, { data: variants }] = await Promise.all([getProductsByIds(supabase, ids), listVariants(supabase, ids)]);
  const catalogue = { products: (products ?? []) as StoreProduct[], variants: (variants ?? []) as StoreVariant[] };
  // Uploaded cover, else the signed page-1 preview render, else null.
  const covers = await coverSrcsFor(storeAdminClient(), catalogue.products);

  // Price each line alone too, so one bad line doesn't blank the whole cart.
  const items = lines.map((line) => {
    const one = priceCart({ lines: [line], fulfilment: "collect" }, catalogue);
    const product = catalogue.products.find((p) => p.id === line.productId);
    const variant = catalogue.variants.find((v) => v.id === line.variantId);
    return one.ok
      ? { ok: true, title: product!.title, kind: product!.kind, variant: variant?.label ?? null, quantity: one.cart.lines[0].quantity, unitCents: one.cart.lines[0].unitPriceCents, totalCents: one.cart.lines[0].lineTotalCents, ships: one.cart.lines[0].ships, productId: line.productId, cover: covers[product!.id] ?? null }
      : { ok: false, title: product?.title ?? "Unavailable", error: one.error, productId: line.productId };
  });

  // Collection only: physical lines are always collected at the base.
  const whole = priceCart({ lines, fulfilment: parsed.data.fulfilment ?? "collect" }, catalogue);
  const needsShipping = whole.ok ? whole.cart.needsShipping : items.some((i) => "ships" in i && i.ships);

  return NextResponse.json(
    {
      items,
      ok: whole.ok,
      error: whole.ok ? null : whole.error,
      subtotalCents: whole.ok ? whole.cart.subtotalCents : items.reduce((s, i) => s + ("totalCents" in i ? (i.totalCents ?? 0) : 0), 0),
      totalCents: whole.ok ? whole.cart.totalCents : null,
      needsShipping,
      fulfilment: whole.ok ? whole.cart.fulfilment : needsShipping ? "collect" : "none",
    },
    { headers: NO_STORE }
  );
}
