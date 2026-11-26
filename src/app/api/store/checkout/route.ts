import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { payfastProvider } from "@/lib/payments/payfast";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { checkoutSchema, orderReference, priceCart } from "@/lib/store/cart";
import { eftDetails, eftInstructionsEmail, sendStoreEmail } from "@/lib/store/emails";
import { appUrl, storePaymentsEnabled } from "@/lib/store/flags";
import { splitName, storePayfastAllowed } from "@/lib/store/payments";
import { createStoreStripeSession, storeStripeAllowed, storeStripeClient } from "@/lib/store/stripe";
import type { StoreProduct, StoreVariant } from "@/lib/store/types";
import { cancelPendingOrder, createOrder, getProductsByIds, listVariants, setStripeSession } from "@/services/store";
import { thanksPath } from "@/lib/store/signing";
import { bad, NO_STORE, readJson } from "../_shared";

// POST /api/store/checkout — public. Prices the cart on the server, creates
// a pending order, and returns where to pay (PayFast sandbox for SA cards,
// Stripe Checkout test mode for international cards) or the EFT thanks page.
// Never marks anything paid: the PayFast ITN, the Stripe webhook or Media does.
export async function POST(request: Request) {
  if (!storePaymentsEnabled()) return bad("Checkout isn't open yet. Check back soon.", 503);

  const limit = await getRateLimiter().hit(`store-checkout:ip:${clientIp(request)}`, { limit: 20, windowSeconds: 600 });
  if (!limit.allowed) return bad("Too many tries. Wait a few minutes and try again.", 429);

  const parsed = checkoutSchema.safeParse(await readJson(request));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check your details");
  const input = parsed.data;

  if (input.paymentMethod === "payfast") {
    const allowed = storePayfastAllowed();
    if (!allowed.ok) return bad(allowed.reason, 503);
  }
  if (input.paymentMethod === "stripe") {
    const allowed = storeStripeAllowed();
    if (!allowed.ok) return bad(allowed.reason, 503);
  }
  const bank = eftDetails();
  if (input.paymentMethod === "eft" && !bank) return bad("EFT isn't set up yet. Pay by card instead.", 503);

  // Catalogue rows with the anon/user client: RLS shows only what's published.
  const supabase = await createClient();
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const [{ data: products, error: pErr }, { data: variants, error: vErr }] = await Promise.all([
    getProductsByIds(supabase, productIds),
    listVariants(supabase, productIds),
  ]);
  if (pErr || vErr) return bad("We couldn't load the store. Try again.", 500);

  const priced = priceCart(
    { lines: input.lines, fulfilment: input.fulfilment, address: input.address ?? null, buyerEmail: input.buyer.email },
    { products: (products ?? []) as StoreProduct[], variants: (variants ?? []) as StoreVariant[] }
  );
  if (!priced.ok) return bad(priced.error, 409);
  const cart = priced.cart;
  if (cart.totalCents <= 0) return bad("There's nothing to pay for.", 409);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const buyerUserId = user?.email?.toLowerCase() === input.buyer.email ? user.id : null;

  const admin = storeAdminClient();
  const { data: created, error } = await createOrder(
    admin,
    {
      reference: orderReference(),
      buyer_email: input.buyer.email,
      buyer_name: input.buyer.name,
      buyer_phone: input.buyer.phone ?? null,
      buyer_user_id: buyerUserId,
      payment_method: input.paymentMethod,
      subtotal_cents: cart.subtotalCents,
      delivery_cents: cart.deliveryCents,
      total_cents: cart.totalCents,
      fulfilment_method: cart.fulfilment,
      delivery_address: cart.fulfilment === "delivery" ? (input.address ?? null) : null,
    },
    cart.lines.map((l) => ({
      product_id: l.product.id,
      variant_id: l.variant?.id ?? null,
      title: l.product.title,
      variant_label: l.variant?.label ?? null,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      purpose: l.purpose,
      gift_recipient_email: l.giftEmail,
      gift_message: l.giftMessage,
    }))
  );
  if (error || !created) return bad("We couldn't save your order. Try again.", 500);
  const { order } = created;
  const base = appUrl();
  const thanksAt = thanksPath(order.id);
  const thanks = `${base}${thanksAt}`;

  if (input.paymentMethod === "eft") {
    const mail = eftInstructionsEmail(order, bank!, thanks);
    await sendStoreEmail({ to: order.buyer_email, ...mail, category: "store_eft_instructions", sourceId: order.id });
    return NextResponse.json({ ok: true, orderId: order.id, next: thanksAt }, { headers: NO_STORE });
  }

  if (input.paymentMethod === "stripe") {
    try {
      const session = await createStoreStripeSession(storeStripeClient().checkout.sessions, order, {
        success: thanks,
        cancel: `${base}/store/checkout?cancelled=${order.id}`,
      });
      const { data: pinned, error: pinErr } = await setStripeSession(admin, order.id, session.id);
      if (pinErr || !pinned) throw new Error("Couldn't pin the Stripe session to the order.");
      return NextResponse.json({ ok: true, orderId: order.id, next: session.url }, { headers: NO_STORE });
    } catch (e) {
      console.error("[store/checkout] Stripe session failed for", order.id, e instanceof Error ? e.message : "unknown");
      await cancelPendingOrder(admin, order.id);
      return bad("We couldn't start the card payment. Try again.", 502);
    }
  }

  const { firstName, lastName } = splitName(order.buyer_name);
  const checkout = await payfastProvider.createCheckout({
    orderId: order.id,
    amountCents: order.total_cents,
    currency: "ZAR",
    description: `Fire & Fragrance Store ${order.reference}`,
    buyer: { firstName, lastName, email: order.buyer_email },
    returnUrl: thanks,
    cancelUrl: `${base}/store/checkout?cancelled=${order.id}`,
    notifyUrl: `${base}/api/integrations/payfast/store-notify`,
  });
  return NextResponse.json({ ok: true, orderId: order.id, next: checkout.redirectUrl }, { headers: NO_STORE });
}
