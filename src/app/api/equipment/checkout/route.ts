import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payfastProvider } from "@/lib/payments/payfast";
import {
  getOrderById,
  insertEquipmentEvent,
  listActiveMinistries,
  markOrderPaymentsStatus,
  moveOrderIfStatus,
  placeOrder,
  updatePayment,
  type EquipmentOrderFull,
} from "@/services/equipment";
import { canBookInternally, checkCart, readCartInput } from "@/lib/equipment/checkout-server";
import { sendRequestReceived } from "@/lib/equipment/emails";

/** How long an unpaid order holds its gear while PayFast is open. */
const HOLD_MINUTES = 30;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function siteBase(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "";
  return `${proto}://${host}`;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "FFSA", last: parts.slice(1).join(" ") || parts[0] || "Hire" };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// POST /api/equipment/checkout — public (spec rules 2, 4, 9, 10, 11).
//
// Re-prices the cart on the server, then places the order in one database
// transaction (equipment_place_order locks each product and re-checks it's
// free). Outside hires become 'awaiting_payment' with a hire and a deposit
// payment and go to PayFast; ministry requests become 'requested' and wait
// for the rental manager.
export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const cart = readCartInput(body);
  if ("error" in cart) return NextResponse.json({ error: cart.error }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const internal = body.internal === true;
  if (internal && !(await canBookInternally(supabase))) {
    return NextResponse.json({ error: "Only ministry bookers can book at the internal rate. Sign in first." }, { status: 403 });
  }

  // ── Details ──
  const name = str(body.customer?.name, 120);
  const email = str(body.customer?.email, 200).toLowerCase();
  const phone = str(body.customer?.phone, 40);
  const org = str(body.customer?.org, 120);
  if (name.length < 2) return NextResponse.json({ error: "Add your full name." }, { status: 400 });
  if (!EMAIL.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  if (phone.replace(/\D/g, "").length < 9) return NextResponse.json({ error: "Add a phone number we can reach you on." }, { status: 400 });

  const idNumber = str(body.idNumber, 40);
  if (!internal && idNumber.replace(/\s/g, "").length < 6) {
    return NextResponse.json({ error: "Add your ID or passport number. We check it when you collect." }, { status: 400 });
  }

  // ── Collection ──
  const fulfilment = body.fulfilment === "delivery" ? "delivery" : "collect";
  const deliveryAddress = str(body.deliveryAddress, 400);
  if (fulfilment === "delivery" && deliveryAddress.length < 8) {
    return NextResponse.json({ error: "Add the address we should deliver to." }, { status: 400 });
  }
  const collectTime = str(body.collectTime, 5);
  const returnTime = str(body.returnTime, 5);
  if ((collectTime && !TIME.test(collectTime)) || (returnTime && !TIME.test(returnTime))) {
    return NextResponse.json({ error: "Pick a collection and return time." }, { status: 400 });
  }

  // ── Ministry ──
  const ministryId = str(body.ministryId, 40);
  const purpose = str(body.purpose, 160);
  if (internal) {
    const { data: ministries } = await listActiveMinistries(supabase);
    if (!(ministries ?? []).some((m: { id: string }) => m.id === ministryId)) {
      return NextResponse.json({ error: "Pick the ministry this is for." }, { status: 400 });
    }
    if (purpose.length < 3) return NextResponse.json({ error: "Say what it's for, e.g. “Youth night”." }, { status: 400 });
  }

  // ── Price it ourselves and make sure it all still fits ──
  const checked = await checkCart(supabase, cart, internal ? "internal" : "external");
  if (!checked.settled) {
    return NextResponse.json(
      { error: "Something in your cart no longer fits your dates. Go back to the cart to sort it out.", cart: checked },
      { status: 409 }
    );
  }

  // ── Agreement ──
  const signed = str(body.agreement?.signedName, 120);
  if (body.agreement?.accepted !== true || signed.length < 2) {
    return NextResponse.json({ error: "Tick the agreement and type your full name to sign it." }, { status: 400 });
  }
  if (body.agreement?.version !== checked.settings.agreement_version) {
    return NextResponse.json({ error: "The agreement has changed since you opened checkout. Read it again and sign." }, { status: 409 });
  }

  const q = checked.quote;
  const now = new Date();
  const admin = createAdminClient();
  const order = {
    kind: internal ? "internal" : "external",
    status: internal ? "requested" : "awaiting_payment",
    customer_user_id: user?.id ?? null,
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    customer_org: org,
    customer_id_number: internal ? null : idNumber,
    ministry_id: internal ? ministryId : null,
    purpose: purpose || null,
    starts_on: cart.from,
    ends_on: cart.to,
    collect_time: collectTime || null,
    return_time: returnTime || null,
    rate_period: q.period,
    fulfilment,
    delivery_address: fulfilment === "delivery" ? deliveryAddress : null,
    subtotal_cents: q.subtotalCents,
    waiver_cents: q.waiverCents,
    vat_cents: q.vatCents,
    total_cents: q.totalCents,
    deposit_cents: q.depositCents,
    agreement_version: checked.settings.agreement_version,
    agreement_accepted_at: now.toISOString(),
    agreement_signed_name: signed,
    hold_expires_at: internal ? null : new Date(now.getTime() + HOLD_MINUTES * 60_000).toISOString(),
    created_by: user?.id ?? null,
  };
  const lines = q.lines.map((l) => ({
    product_id: l.productId,
    quantity: l.quantity,
    unit_price_cents: l.unitPriceCents,
    deposit_cents: l.depositCents,
    line_total_cents: l.lineTotalCents,
  }));
  const payments = internal
    ? []
    : [
        { kind: "hire", amount_cents: q.totalCents, xero_item_code: checked.settings.xero_item_code },
        { kind: "deposit", amount_cents: q.depositCents, xero_item_code: null },
      ];

  const { data: row, error: placeErr } = await placeOrder(admin, order, lines, payments);
  if (placeErr) {
    const m = /EQUIPMENT_NOT_FREE:([0-9a-f-]+):(\d+)/.exec(placeErr.message);
    if (m) {
      const line = checked.lines.find((l) => l.productId === m[1]);
      return NextResponse.json(
        {
          error: `Someone booked ${line?.title ?? "an item"} while you were checking out. Only ${m[2]} ${Number(m[2]) === 1 ? "is" : "are"} free now. Go back to the cart to sort it out.`,
        },
        { status: 409 }
      );
    }
    console.error("[equipment/checkout] place order failed:", placeErr.message);
    return NextResponse.json({ error: "We couldn't place the order. Try again in a moment." }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "We couldn't place the order. Try again in a moment." }, { status: 500 });
  const base = siteBase(request);
  const rentalUrl = `${base}/hire/o/${row.access_token}`;

  await insertEquipmentEvent(admin, {
    order_id: row.id,
    kind: internal ? "requested" : "checkout",
    detail: internal ? `Ministry request sent by ${name}.` : `Checkout started by ${name}; waiting on PayFast.`,
    actor_id: user?.id ?? null,
  });

  if (internal) {
    const { data: full } = await getOrderById(admin, row.id);
    if (full) await sendRequestReceived(full as EquipmentOrderFull);
    return NextResponse.json({ orderUrl: `/hire/o/${row.access_token}` });
  }

  // ── PayFast: one checkout for hire + deposit ──
  const amountCents = q.totalCents + q.depositCents;
  const { first, last } = splitName(name);
  try {
    const checkout = await payfastProvider.createCheckout({
      orderId: row.id,
      amountCents,
      currency: "ZAR",
      description: `Equipment hire ${row.number}`,
      buyer: { firstName: first, lastName: last, email },
      returnUrl: `${rentalUrl}?paid=1`,
      cancelUrl: `${rentalUrl}?cancelled=1`,
      notifyUrl: `${base}/api/integrations/payfast/equipment-notify`,
    });
    const { data: full } = await getOrderById(admin, row.id);
    const hire = (full as EquipmentOrderFull | null)?.payments.find((p) => p.kind === "hire");
    if (hire) await updatePayment(admin, hire.id, { provider_reference: checkout.reference });
    return NextResponse.json({ redirectUrl: checkout.redirectUrl });
  } catch (e) {
    // Couldn't reach PayFast: release the hold rather than leave it blocking stock.
    console.error("[equipment/checkout] PayFast failed:", e instanceof Error ? e.message : e);
    await markOrderPaymentsStatus(admin, row.id, "failed");
    await moveOrderIfStatus(admin, row.id, ["awaiting_payment"], { status: "cancelled", hold_expires_at: null });
    return NextResponse.json({ error: "We couldn't open PayFast. Nothing was charged. Try again in a moment." }, { status: 502 });
  }
}
