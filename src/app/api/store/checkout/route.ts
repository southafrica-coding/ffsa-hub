import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { payfastProvider } from "@/lib/payments/payfast";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { checkoutSchema, orderReference, priceCart } from "@/lib/store/cart";
import { checkCouponCode, couponGuessAllowed } from "@/lib/store/coupon-server";
import { COUPON_ERRORS, PROVIDER_MIN_CENTS, providerCanCharge, type CouponRefusal } from "@/lib/store/coupons";
import { eftDetails, eftInstructionsEmail, sendStoreEmail } from "@/lib/store/emails";
import { appUrl, storePaymentsEnabled } from "@/lib/store/flags";
import { settleAndNotify } from "@/lib/store/fulfil";
import { formatZar } from "@/lib/store/money";
import { splitName, storePayfastAllowed } from "@/lib/store/payments";
import { createStoreStripeSession, storeStripeAllowed, storeStripeClient } from "@/lib/store/stripe";
import type { PaymentMethod, StoreOrder, StoreProduct, StoreVariant } from "@/lib/store/types";
import { applyCouponToOrder, cancelPendingOrder, createOrder, deleteOrder, getProductsByIds, listVariants, setStripeSession, undoFreeOrder } from "@/services/store";
import { thanksPath } from "@/lib/store/signing";
import { bad, NO_STORE, readJson } from "../_shared";

// POST /api/store/checkout — public. Prices the cart on the server, creates
// a pending order, and returns where to pay (PayFast sandbox for SA cards,
// Stripe Checkout test mode for international cards) or the EFT thanks page.
// Never marks a paid order paid itself: the PayFast ITN, the Stripe webhook
// or Media does.
//
// Coupons (413): the buyer sends the code as typed. The server normalises
// it, re-checks it against this cart, then store_apply_coupon takes the use
// and stamps the order in one transaction. When a valid code brings the
// order to R0 (and only then) the order is 'free' and is settled here and
// now, through the same settle path a payment uses. No provider is called.
export async function POST(request: Request) {
  if (!storePaymentsEnabled()) return bad("Checkout isn't open yet. Check back soon.", 503);

  const limit = await getRateLimiter().hit(`store-checkout:ip:${clientIp(request)}`, { limit: 20, windowSeconds: 600 });
  if (!limit.allowed) return bad("Too many tries. Wait a few minutes and try again.", 429);

  const parsed = checkoutSchema.safeParse(await readJson(request));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check your details");
  const input = parsed.data;

  // Catalogue rows with the anon/user client: RLS shows only what's published.
  const supabase = await createClient();
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const [{ data: products, error: pErr }, { data: variants, error: vErr }] = await Promise.all([
    getProductsByIds(supabase, productIds),
    listVariants(supabase, productIds),
  ]);
  if (pErr || vErr) return bad("We couldn't load the store. Try again.", 500);

  const priced = priceCart(
    { lines: input.lines, fulfilment: input.fulfilment, buyerEmail: input.buyer.email },
    { products: (products ?? []) as StoreProduct[], variants: (variants ?? []) as StoreVariant[] }
  );
  if (!priced.ok) return bad(priced.error, 409);
  const cart = priced.cart;

  const admin = storeAdminClient();

  // The code, re-checked here; what it saves is recomputed, never taken from the client.
  let discountCents = 0;
  let couponCode: string | null = null;
  if (input.couponCode) {
    if (!(await couponGuessAllowed(request))) return bad("Too many tries. Wait a few minutes and try again.", 429);
    const check = await checkCouponCode(admin, input.couponCode, cart);
    if (!check.ok) return NextResponse.json({ error: check.error, coupon: check.reason }, { status: check.reason === "unavailable" ? 503 : 409, headers: NO_STORE });
    discountCents = check.discountCents;
    couponCode = check.coupon.code;
  }
  const totalCents = cart.totalCents - discountCents;

  // R0 is only ever "free" because a valid code made it so.
  if (totalCents <= 0 && !couponCode) return bad("There's nothing to pay for.", 409);
  const free = totalCents === 0;

  let method: PaymentMethod;
  const bank = eftDetails();
  if (free) {
    method = "free";
  } else {
    if (!input.paymentMethod) return bad("Choose how you'd like to pay.");
    method = input.paymentMethod;
    if (method === "payfast") {
      const allowed = storePayfastAllowed();
      if (!allowed.ok) return bad(allowed.reason, 503);
    }
    if (method === "stripe") {
      const allowed = storeStripeAllowed();
      if (!allowed.ok) return bad(allowed.reason, 503);
    }
    if (method === "eft" && !bank) return bad("EFT isn't set up yet. Pay by card instead.", 503);
    // A small total left after a code can be below what a card provider takes.
    if ((method === "payfast" || method === "stripe") && !providerCanCharge(method, totalCents)) {
      const floor = formatZar(PROVIDER_MIN_CENTS[method]);
      return bad(
        bank
          ? `Card payments start at ${floor}. Pay ${formatZar(totalCents)} by EFT instead, or add something to your cart.`
          : `Card payments start at ${floor}. Add something to your cart to pay by card.`,
        409
      );
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const buyerUserId = user?.email?.toLowerCase() === input.buyer.email ? user.id : null;

  const { data: created, error } = await createOrder(
    admin,
    {
      reference: orderReference(),
      buyer_email: input.buyer.email,
      buyer_name: input.buyer.name,
      buyer_phone: input.buyer.phone ?? null,
      buyer_user_id: buyerUserId,
      payment_method: method,
      subtotal_cents: cart.subtotalCents,
      delivery_cents: cart.deliveryCents,
      total_cents: cart.totalCents,
      fulfilment_method: cart.fulfilment,
      delivery_address: null,
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
  let order: StoreOrder = created.order;

  if (couponCode) {
    // Take the use and stamp the order, atomically. Refused → the order goes
    // (deleting it removes any redemption, which gives the use back).
    const { data: applied, error: applyErr } = await applyCouponToOrder(admin, order.id, couponCode, discountCents);
    if (applyErr || !applied || applied.outcome !== "ok" || applied.total_cents !== totalCents) {
      if (applyErr) console.error("[store/checkout] coupon apply failed for", order.id, applyErr.code ?? "", applyErr.message ?? "");
      await deleteOrder(admin, order.id);
      const reason = applied?.outcome;
      const copy = reason && reason in COUPON_ERRORS ? COUPON_ERRORS[reason as CouponRefusal] : "We couldn't use that code just now. Try again.";
      return NextResponse.json({ error: copy, coupon: reason ?? "unavailable" }, { status: applyErr ? 500 : 409, headers: NO_STORE });
    }
    order = { ...order, coupon_id: applied.coupon_id ?? null, discount_cents: discountCents, total_cents: totalCents };
  }

  const base = appUrl();
  const thanksAt = thanksPath(order.id);
  const thanks = `${base}${thanksAt}`;

  if (free) {
    // Settled now, the same way a payment settles it: entitlements, gift and
    // pack codes, fulfilment, emails. If that fails, undo and give the use back.
    const outcome = await settleAndNotify(admin, { orderId: order.id });
    if (outcome === "error") {
      console.error("[store/checkout] free order didn't settle", order.id);
      await undoFreeOrder(admin, order.id);
      return bad("We couldn't complete your order. Nothing was charged. Try again.", 500);
    }
    return NextResponse.json({ ok: true, orderId: order.id, next: thanksAt, free: true }, { headers: NO_STORE });
  }

  if (method === "eft") {
    const mail = eftInstructionsEmail(order, bank!, thanks);
    await sendStoreEmail({ to: order.buyer_email, ...mail, category: "store_eft_instructions", sourceId: order.id });
    return NextResponse.json({ ok: true, orderId: order.id, next: thanksAt }, { headers: NO_STORE });
  }

  if (method === "stripe") {
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
      // Cancelling gives any coupon use back (413 trigger).
      await cancelPendingOrder(admin, order.id);
      return bad("We couldn't start the card payment. Try again.", 502);
    }
  }

  const { firstName, lastName } = splitName(order.buyer_name);
  try {
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
  } catch (e) {
    console.error("[store/checkout] PayFast checkout failed for", order.id, e instanceof Error ? e.message : "unknown");
    await cancelPendingOrder(admin, order.id);
    return bad("We couldn't start the card payment. Try again.", 502);
  }
}
