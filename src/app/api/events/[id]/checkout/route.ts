import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payfastProvider } from "@/lib/payments/payfast";
import { stripeProvider } from "@/lib/payments/stripe";
import type { PaymentProvider } from "@/lib/payments/provider";
import type { Json } from "@/types/database";
import type { FormField } from "@/lib/forms/schema";
import {
  eventCurrency,
  formatMoney,
  providersForCurrency,
} from "@/lib/currencies";
import {
  validateCheckoutAnswers,
  snapshotAnswers,
} from "@/lib/ticketing/checkout-questions";
import {
  buildTicketAnswerGroups,
  type TicketAnswerGroup,
} from "@/lib/ticketing/ticket-questions";

// POST /api/events/[id]/checkout
//
// Public endpoint — uses the service-role client to bypass RLS.
// Steps: validate → reserve inventory atomically → apply promo →
// create pending order → kick off PayFast → return { redirectUrl }.
//
// Free / fully-comped orders (total_cents == 0) are rejected for
// now — fulfilment without a payment-provider round-trip arrives
// with ticket 10. Spam protection (Turnstile / rate limit) is a
// pre-launch item; see the spec.

type Body = {
  lines?: Array<{
    ticket_type_id?: string;
    qty?: number;
    pwyw_amount_cents?: number | null;
  }>;
  donation_cents?: number;
  promo_code?: string | null;
  buyer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string | null;
  };
  marketing_consent?: boolean;
  custom_answers?: Record<string, unknown>;
  // Per-ticket answers to each tier's questions (migration 137). One
  // entry per ticket whose tier has questions; validated + snapshotted
  // server-side against the tier's own schema.
  ticket_answers?: Array<{
    ticket_type_id?: string;
    answers?: Record<string, unknown>;
  }>;
  payment_provider?: "payfast" | "stripe";
};

type TicketTypeRow = {
  id: string;
  name: string;
  pricing_mode: string;
  display_price_cents: number;
  capacity: number | null;
  quantity_sold: number;
  max_per_order: number | null;
  sales_start_at: string | null;
  sales_end_at: string | null;
  is_active: boolean;
  questions: FormField[] | null;
};

type ResolvedLine = {
  ticketType: TicketTypeRow;
  qty: number;
  perTicketCents: number;
};

const EXPIRY_MINUTES = 30;

function siteBase(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "";
  return `${proto}://${host}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function describeOrder(eventTitle: string, totalQty: number): string {
  const text = `${eventTitle} — ${totalQty} ticket${totalQty > 1 ? "s" : ""}`;
  return text.length > 100 ? text.slice(0, 97) + "..." : text;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = createAdminClient();

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Buyer validation ─────────────────────────────────────────
  const buyer = body.buyer ?? {};
  const firstName = buyer.first_name?.trim() ?? "";
  const lastName = buyer.last_name?.trim() ?? "";
  const emailRaw = buyer.email?.trim() ?? "";
  const phoneRaw = buyer.phone?.trim() ?? "";
  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "Please enter your first and last name." },
      { status: 400 }
    );
  }
  if (!isValidEmail(emailRaw)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  // ── Event ────────────────────────────────────────────────────
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, title, status, ticketing_enabled, public_slug, checkout_questions, currency"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (
    !event.ticketing_enabled ||
    event.status !== "published" ||
    !event.public_slug
  ) {
    return NextResponse.json(
      { error: "This event isn't currently selling tickets." },
      { status: 409 }
    );
  }

  // ── Provider ────────────────────────────────────────────────
  // Which providers can take this event's currency: PayFast is
  // ZAR-only, so a USD event is Stripe-only. The storefront hides the
  // ineligible button; this is the authoritative check.
  const currency = eventCurrency(event.currency).code;
  const eligibleProviders = providersForCurrency(currency);
  const providerName = body.payment_provider ?? eligibleProviders[0];
  if (providerName !== "payfast" && providerName !== "stripe") {
    return NextResponse.json(
      { error: "Unknown payment provider." },
      { status: 400 }
    );
  }
  if (!eligibleProviders.includes(providerName)) {
    return NextResponse.json(
      { error: `${providerName} can't take payments in ${currency}.` },
      { status: 409 }
    );
  }
  const providerImpl: PaymentProvider =
    providerName === "stripe" ? stripeProvider : payfastProvider;

  // ── Custom checkout questions (optional, per event) ──────────
  // Validated before any inventory is reserved, so a bad/missing answer
  // returns a clean 400 with no rollback. Answers are snapshotted
  // (label + value) onto the order.
  const checkoutQuestions =
    (event.checkout_questions as FormField[] | null) ?? [];
  const customAnswersInput =
    body.custom_answers && typeof body.custom_answers === "object"
      ? (body.custom_answers as Record<string, unknown>)
      : {};
  if (checkoutQuestions.length > 0) {
    const v = validateCheckoutAnswers(checkoutQuestions, customAnswersInput);
    if (!v.valid) {
      return NextResponse.json(
        { error: "Please answer the required questions.", fieldErrors: v.errors },
        { status: 400 }
      );
    }
  }
  const customAnswersSnapshot = snapshotAnswers(
    checkoutQuestions,
    customAnswersInput
  );

  // ── Line items ───────────────────────────────────────────────
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Add at least one ticket." }, { status: 400 });
  }

  const ticketTypeIds = Array.from(
    new Set(
      rawLines.map((l) => l.ticket_type_id).filter((x): x is string => !!x)
    )
  );
  const { data: typesData, error: typesErr } = await supabase
    .from("ticket_types")
    .select(
      "id, name, pricing_mode, display_price_cents, capacity, quantity_sold, max_per_order, sales_start_at, sales_end_at, is_active, questions"
    )
    .eq("event_id", eventId)
    .in("id", ticketTypeIds);
  if (typesErr) {
    return NextResponse.json(
      { error: "Couldn't load ticket types." },
      { status: 500 }
    );
  }
  const typeMap = new Map<string, TicketTypeRow>(
    ((typesData as TicketTypeRow[] | null) ?? []).map((t) => [t.id, t])
  );

  const now = new Date();
  const resolved: ResolvedLine[] = [];
  for (const line of rawLines) {
    const ttId = line.ticket_type_id;
    const qty = typeof line.qty === "number" ? Math.floor(line.qty) : 0;
    if (!ttId || qty <= 0) {
      return NextResponse.json(
        { error: "Each line needs a tier and qty >= 1." },
        { status: 400 }
      );
    }
    const tt = typeMap.get(ttId);
    if (!tt || !tt.is_active) {
      return NextResponse.json(
        { error: "One of the tiers is no longer available." },
        { status: 409 }
      );
    }
    if (tt.sales_start_at && new Date(tt.sales_start_at) > now) {
      return NextResponse.json(
        { error: `Sales for "${tt.name}" haven't opened yet.` },
        { status: 409 }
      );
    }
    if (tt.sales_end_at && new Date(tt.sales_end_at) <= now) {
      return NextResponse.json(
        { error: `Sales for "${tt.name}" have closed.` },
        { status: 409 }
      );
    }
    if (tt.max_per_order != null && qty > tt.max_per_order) {
      return NextResponse.json(
        { error: `${tt.name}: max ${tt.max_per_order} per order.` },
        { status: 400 }
      );
    }
    let perTicketCents: number;
    if (tt.pricing_mode === "pwyw") {
      const entered =
        typeof line.pwyw_amount_cents === "number"
          ? Math.floor(line.pwyw_amount_cents)
          : 0;
      if (entered < tt.display_price_cents) {
        return NextResponse.json(
          {
            error: `${tt.name}: amount must be at least ${formatMoney(tt.display_price_cents, currency)}.`,
          },
          { status: 400 }
        );
      }
      perTicketCents = entered;
    } else {
      perTicketCents = tt.display_price_cents;
    }
    resolved.push({ ticketType: tt, qty, perTicketCents });
  }

  // ── Per-ticket tier questions (optional, migration 137) ──────
  // Validated against each tier's own schema before any inventory is
  // reserved — a bad/missing per-ticket answer returns a clean 400 with
  // no rollback. The snapshot rides on the order until fulfilment drains
  // it onto each issued ticket.
  const ticketAnswerBuild = buildTicketAnswerGroups(
    resolved.map((r) => ({
      ticketTypeId: r.ticketType.id,
      qty: r.qty,
      questions: (r.ticketType.questions as FormField[] | null) ?? [],
    })),
    Array.isArray(body.ticket_answers) ? body.ticket_answers : []
  );
  if (!ticketAnswerBuild.valid) {
    return NextResponse.json(
      { error: ticketAnswerBuild.error ?? "Please answer the required questions." },
      { status: 400 }
    );
  }
  const ticketAnswerGroups: TicketAnswerGroup[] = ticketAnswerBuild.groups;

  // ── Reserve inventory atomically ─────────────────────────────
  const reserved: Array<{ ticketTypeId: string; qty: number }> = [];
  const rollbackReservations = async () => {
    for (const r of reserved) {
      await supabase.rpc("release_ticket_inventory", {
        p_ticket_type_id: r.ticketTypeId,
        p_qty: r.qty,
      });
    }
  };

  for (const line of resolved) {
    const { data: heldRow, error: rpcErr } = await supabase.rpc(
      "reserve_ticket_inventory",
      {
        p_ticket_type_id: line.ticketType.id,
        p_qty: line.qty,
      }
    );
    if (rpcErr) {
      await rollbackReservations();
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
    if (!heldRow) {
      // Reservation rejected by guards (sold out / inactive / window).
      await rollbackReservations();
      return NextResponse.json(
        {
          error: `"${line.ticketType.name}" is no longer available in that quantity.`,
        },
        { status: 409 }
      );
    }
    reserved.push({ ticketTypeId: line.ticketType.id, qty: line.qty });
  }

  // ── Promo code (optional) ────────────────────────────────────
  const subtotalCents = resolved.reduce(
    (s, l) => s + l.qty * l.perTicketCents,
    0
  );
  let discountCents = 0;
  let promoCodeId: string | null = null;

  const codeInput = body.promo_code?.trim();
  if (codeInput) {
    const { data: promo, error: promoErr } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("event_id", eventId)
      .ilike("code", codeInput)
      .eq("is_active", true)
      .maybeSingle();
    if (promoErr) {
      await rollbackReservations();
      return NextResponse.json(
        { error: "Failed to validate promo code." },
        { status: 500 }
      );
    }
    if (!promo) {
      await rollbackReservations();
      return NextResponse.json(
        { error: "That promo code isn't valid." },
        { status: 409 }
      );
    }
    if (promo.valid_from && new Date(promo.valid_from) > now) {
      await rollbackReservations();
      return NextResponse.json(
        { error: "That promo code isn't active yet." },
        { status: 409 }
      );
    }
    if (promo.valid_until && new Date(promo.valid_until) <= now) {
      await rollbackReservations();
      return NextResponse.json(
        { error: "That promo code has expired." },
        { status: 409 }
      );
    }
    if (
      promo.max_redemptions != null &&
      promo.redemption_count >= promo.max_redemptions
    ) {
      await rollbackReservations();
      return NextResponse.json(
        { error: "That promo code has been fully redeemed." },
        { status: 409 }
      );
    }
    if (
      promo.applies_to_ticket_type_id &&
      !resolved.some((r) => r.ticketType.id === promo.applies_to_ticket_type_id)
    ) {
      await rollbackReservations();
      return NextResponse.json(
        {
          error: "That promo code doesn't apply to any of the tiers in your order.",
        },
        { status: 409 }
      );
    }
    if (promo.kind === "percent") {
      discountCents = Math.round(
        (subtotalCents * (promo.percent_off ?? 0)) / 100
      );
    } else if (promo.kind === "fixed_amount") {
      discountCents = Math.min(subtotalCents, promo.amount_off_cents ?? 0);
    } else if (promo.kind === "comp") {
      discountCents = subtotalCents;
    }
    promoCodeId = promo.id;
  }

  // ── Totals ───────────────────────────────────────────────────
  const donationCents = Math.max(
    0,
    typeof body.donation_cents === "number"
      ? Math.floor(body.donation_cents)
      : 0
  );
  const totalCents =
    Math.max(0, subtotalCents - discountCents) + donationCents;

  if (totalCents <= 0) {
    // Fully-comped orders aren't fulfilled yet — fulfilment arrives
    // in ticket 10. Roll back and reject for now.
    await rollbackReservations();
    return NextResponse.json(
      {
        error:
          "Free / fully-comped orders aren't supported yet. Add a small donation, or remove the comp code.",
      },
      { status: 400 }
    );
  }

  // ── Create order ─────────────────────────────────────────────
  const expiresAt = new Date(
    now.getTime() + EXPIRY_MINUTES * 60_000
  ).toISOString();
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      event_id: eventId,
      buyer_first_name: firstName,
      buyer_last_name: lastName,
      buyer_email: emailRaw,
      buyer_phone: phoneRaw || null,
      marketing_consent: !!body.marketing_consent,
      status: "pending",
      contact_resolution: "pending",
      payment_provider: providerName,
      currency,
      subtotal_cents: subtotalCents,
      discount_cents: discountCents,
      donation_cents: donationCents,
      total_cents: totalCents,
      promo_code_id: promoCodeId,
      lines: resolved.map((r) => ({
        ticket_type_id: r.ticketType.id,
        qty: r.qty,
        per_ticket_cents: r.perTicketCents,
      })),
      // Snapshot values originate from the parsed JSON request body, so
      // they're already JSON-serializable; cast past the `unknown` value type.
      custom_answers: customAnswersSnapshot as unknown as Json,
      // Per-ticket answers, drained onto tickets at fulfilment.
      ticket_answers: ticketAnswerGroups as unknown as Json,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (orderErr || !order) {
    await rollbackReservations();
    return NextResponse.json(
      { error: "Couldn't create order." },
      { status: 500 }
    );
  }

  // ── Atomically redeem promo ──────────────────────────────────
  if (promoCodeId) {
    const { data: redeemed, error: redeemErr } = await supabase.rpc(
      "redeem_promo_code",
      { p_promo_code_id: promoCodeId }
    );
    if (redeemErr || !redeemed) {
      // Race: another buyer grabbed the last redemption between our
      // validation and our redeem. Cancel + roll back.
      await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      await rollbackReservations();
      return NextResponse.json(
        {
          error: "That promo code was just fully redeemed by another buyer.",
        },
        { status: 409 }
      );
    }
  }

  // ── Provider checkout ───────────────────────────────────────
  const base = siteBase(request);
  const totalQty = resolved.reduce((s, l) => s + l.qty, 0);
  const notifyUrl =
    providerName === "stripe"
      ? `${base}/api/integrations/stripe/notify`
      : `${base}/api/integrations/payfast/notify`;
  let checkout;
  try {
    checkout = await providerImpl.createCheckout({
      orderId: order.id,
      amountCents: totalCents,
      currency,
      description: describeOrder(event.title, totalQty),
      buyer: { firstName, lastName, email: emailRaw },
      returnUrl: `${base}/e/${event.public_slug}/thanks?order=${order.id}`,
      cancelUrl: `${base}/e/${event.public_slug}`,
      notifyUrl,
    });
  } catch (e) {
    // Provider misconfigured (env missing) or similar. The order is
    // still pending; expires_at will sweep its inventory.
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Couldn't start the checkout.",
      },
      { status: 500 }
    );
  }

  await supabase
    .from("orders")
    .update({ provider_reference: checkout.reference })
    .eq("id", order.id);

  return NextResponse.json({ redirectUrl: checkout.redirectUrl });
}
