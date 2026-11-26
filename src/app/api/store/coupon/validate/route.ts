import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cartLineSchema, MAX_CART_LINES, priceCart } from "@/lib/store/cart";
import { checkCouponCode, couponGuessAllowed } from "@/lib/store/coupon-server";
import { COUPON_ERRORS } from "@/lib/store/coupons";
import { storeAdminClient } from "@/lib/store/db";
import type { StoreProduct, StoreVariant } from "@/lib/store/types";
import { getProductsByIds, listVariants } from "@/services/store";
import { bad, NO_STORE, readJson } from "../../_shared";

const schema = z.object({
  code: z.string().max(80),
  lines: z.array(cartLineSchema).min(1, "Your cart is empty").max(MAX_CART_LINES),
});

// POST /api/store/coupon/validate — public. Checks a code against the cart
// the buyer has now (same line shape as quote / checkout) and says what it
// saves. Takes nothing: the use is only taken at checkout, where the code
// is checked again. Rate-limited per IP on the shared coupon bucket.
export async function POST(request: Request) {
  if (!(await couponGuessAllowed(request))) return bad("Too many tries. Wait a few minutes and try again.", 429);

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) {
    const onCode = parsed.error.issues.some((i) => i.path[0] === "code");
    return NextResponse.json(onCode ? { error: COUPON_ERRORS.malformed, reason: "malformed" } : { error: "Your cart couldn't be read" }, { status: 400, headers: NO_STORE });
  }

  const supabase = await createClient();
  const ids = [...new Set(parsed.data.lines.map((l) => l.productId))];
  const [{ data: products, error: pErr }, { data: variants, error: vErr }] = await Promise.all([getProductsByIds(supabase, ids), listVariants(supabase, ids)]);
  if (pErr || vErr) return bad("We couldn't load the store. Try again.", 500);
  const priced = priceCart(
    { lines: parsed.data.lines, fulfilment: "collect" },
    { products: (products ?? []) as StoreProduct[], variants: (variants ?? []) as StoreVariant[] }
  );
  if (!priced.ok) return bad(priced.error, 409);

  const check = await checkCouponCode(storeAdminClient(), parsed.data.code, priced.cart);
  if (!check.ok) {
    const status = check.reason === "unavailable" ? 503 : check.reason === "malformed" ? 400 : check.reason === "unknown" ? 404 : 409;
    return NextResponse.json({ error: check.error, reason: check.reason }, { status, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      ok: true,
      code: check.coupon.code,
      summary: check.summary,
      subtotalCents: priced.cart.subtotalCents,
      deliveryCents: priced.cart.deliveryCents,
      discountCents: check.discountCents,
      totalCents: check.totalCents,
    },
    { headers: NO_STORE }
  );
}
