"use client";

import { PayLaterCountry } from "./pay-later-country";
import { useMemo, useState } from "react";
import { PhoneInputNative } from "@/components/ui/phone-input-native";
import { EventDescription } from "@/components/events/event-description";
import type { FormField } from "@/lib/forms/schema";
import { validateCheckoutAnswers } from "@/lib/ticketing/checkout-questions";
import {
  computeTicketSlots,
  collectTicketAnswers,
} from "@/lib/ticketing/ticket-questions";
import {
  computeWaiverSlots,
  collectWaiverSignatures,
  type TierWaiver,
  type WaiverSlotValues,
} from "@/lib/ticketing/waivers";
import {
  cartPromoDiscount,
  describeWaivedForCart,
  questionsAfterPromo,
  toPromoTerms,
  waiverAfterPromo,
  type PromoTerms,
} from "@/lib/ticketing/promo-codes";
import {
  buyerFieldMap,
  type BuyerFieldConfig,
} from "@/lib/ticketing/buyer-fields";
import { formatMoney, providersForCurrency } from "@/lib/currencies";
import {
  TICKET_CONSENT_CHECKBOX_LABEL,
  TICKET_CONSENT_URL,
} from "@/lib/ticketing/consent-terms";
import {
  CheckoutQuestionFields,
  type CheckoutFieldClasses,
} from "./checkout-questions-fields";
import { TicketQuestionsSection } from "./ticket-questions-section";
import { WaiverSignatureSection } from "./waiver-signature-section";
import {
  MISSIO_FONT_FAMILY,
  MISSIO_WORDMARK_ALT,
  MISSIO_WORDMARK_SRC,
} from "@/lib/brand/missio-font";

// Custom checkout questions, themed to MISSIO's scoped `.wo-*` classes.
const MISSIO_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "wo-field",
  label: "wo-label",
  required: "",
  input: "wo-input",
  textarea: "wo-input",
  select: "wo-input",
  optionRow: "wo-opt-row",
  optionText: "",
  help: "wo-checkout-help",
  error: "wo-promo-error",
};

// ──────────────────────────────────────────────────────────────
// MISSIO
// Bespoke ticketing landing page, built around the official MISSIŌ
// wordmark. Aesthetic: light and quiet — warm off-white paper, near-black
// type, 1px near-black rules, bold geometric Archivo caps, square corners,
// generous whitespace, no accent colour. All checkout state/handlers mirror
// the generic Storefront + THE SEND + FFSA Camps + PREACHERS + WILD ONES
// storefronts exactly — only the visual layer differs.
// Slogan: "SENT ON MISSION"
// ──────────────────────────────────────────────────────────────

type TicketType = {
  id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  display_price_cents: number;
  target_net_cents: number;
  capacity: number | null;
  quantity_sold: number;
  max_per_order: number | null;
  sales_start_at: string | null;
  sales_end_at: string | null;
  questions?: FormField[] | null;
  waiver?: TierWaiver | null;
};

type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  logo_url: string | null;
  currency: string;
  // "Invoice me, pay later" offered (events.pay_later_enabled + Xero item).
  pay_later?: boolean;
};

type LineItem = {
  ticketTypeId: string;
  qty: number;
  pwywAmountCents: number | null;
};

// Discount + the steps the code skips (see promo-codes.ts).
type AppliedPromo = PromoTerms;

// A tier's sales window is open when now sits inside [start, end). A tier with
// no window (both null) is always open — that's the "regular" always-on ticket.
function isWindowOpen(t: TicketType, now: Date): boolean {
  if (t.sales_start_at && new Date(t.sales_start_at) > now) return false;
  if (t.sales_end_at && new Date(t.sales_end_at) <= now) return false;
  return true;
}

function isOnSale(t: TicketType, now: Date): boolean {
  if (!isWindowOpen(t, now)) return false;
  if (t.capacity != null && t.quantity_sold >= t.capacity) return false;
  return true;
}

function remaining(t: TicketType): number | null {
  if (t.capacity == null) return null;
  return Math.max(0, t.capacity - t.quantity_sold);
}

export function MissioStorefront({
  event,
  ticketTypes,
  checkoutQuestions,
  buyerFields,
}: {
  event: PublicEvent;
  ticketTypes: TicketType[];
  checkoutQuestions: FormField[];
  buyerFields: BuyerFieldConfig[];
}) {
  const bf = buyerFieldMap(buyerFields);
  // Every price on this page is in the event's own currency, and
  // PayFast can only take ZAR — so a non-ZAR event is card-only.
  const currency = event.currency;
  const money = (cents: number) => formatMoney(cents, currency);
  const canUsePayfast = providersForCurrency(currency).includes("payfast");
  const now = useMemo(() => new Date(), []);
  // Only show tiers whose sales window is currently open. Tiers scheduled for
  // later (or already closed) stay hidden until/while they're in their window.
  const visibleTickets = useMemo(
    () => ticketTypes.filter((t) => isWindowOpen(t, now)),
    [ticketTypes, now]
  );
  const [lines, setLines] = useState<Record<string, LineItem>>({});
  const [donationRands, setDonationRands] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [customAnswers, setCustomAnswers] = useState<Record<string, unknown>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [ticketAnswers, setTicketAnswers] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [ticketErrors, setTicketErrors] = useState<
    Record<string, Record<string, string>>
  >({});
  const [submitting, setSubmitting] = useState<"payfast" | "stripe" | "invoice" | null>(null);
  // Pay later only: which of our Xero orgs invoices them (see PayLaterCountry).
  const [invoiceCountry, setInvoiceCountry] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const questionsByTier = useMemo(() => {
    const m: Record<string, FormField[]> = {};
    // An applied promo code can skip some of a tier's questions.
    for (const t of ticketTypes) {
      m[t.id] = questionsAfterPromo(t.questions ?? [], appliedPromo, t.id);
    }
    return m;
  }, [ticketTypes, appliedPromo]);
  const ticketSlots = useMemo(
    () =>
      computeTicketSlots(
        Object.values(lines).map((l) => ({
          ticketTypeId: l.ticketTypeId,
          ticketTypeName:
            ticketTypes.find((t) => t.id === l.ticketTypeId)?.name ?? "Ticket",
          qty: l.qty,
        })),
        questionsByTier
      ),
    [lines, ticketTypes, questionsByTier]
  );
  const [waiverValues, setWaiverValues] = useState<
    Record<string, WaiverSlotValues>
  >({});
  const [waiverErrors, setWaiverErrors] = useState<
    Record<string, Record<string, string>>
  >({});
  const waiverByTier = useMemo(() => {
    const m: Record<string, TierWaiver | null | undefined> = {};
    // An applied promo code can skip a tier's waiver.
    for (const t of ticketTypes) m[t.id] = waiverAfterPromo(t.waiver, appliedPromo, t.id);
    return m;
  }, [ticketTypes, appliedPromo]);
  const waiverSlots = useMemo(
    () =>
      computeWaiverSlots(
        Object.values(lines).map((l) => ({
          ticketTypeId: l.ticketTypeId,
          ticketTypeName:
            ticketTypes.find((t) => t.id === l.ticketTypeId)?.name ?? "Ticket",
          qty: l.qty,
        })),
        waiverByTier
      ),
    [lines, ticketTypes, waiverByTier]
  );

  function setQty(t: TicketType, qty: number) {
    setLines((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[t.id];
      } else {
        const cap = t.max_per_order ?? Infinity;
        const rem = remaining(t) ?? Infinity;
        const clamped = Math.min(qty, cap, rem);
        const existing = prev[t.id];
        next[t.id] = {
          ticketTypeId: t.id,
          qty: clamped,
          pwywAmountCents:
            t.pricing_mode === "pwyw"
              ? existing?.pwywAmountCents ?? t.display_price_cents
              : null,
        };
      }
      return next;
    });
  }

  function setPwywAmount(t: TicketType, value: string) {
    setLines((prev) => {
      const existing = prev[t.id];
      if (!existing) return prev;
      const cents = Math.max(
        t.display_price_cents,
        Math.round((Number.parseFloat(value) || 0) * 100)
      );
      return { ...prev, [t.id]: { ...existing, pwywAmountCents: cents } };
    });
  }

  const subtotalCents = Object.values(lines).reduce((sum, line) => {
    const tt = ticketTypes.find((x) => x.id === line.ticketTypeId);
    if (!tt) return sum;
    const per = line.pwywAmountCents ?? tt.display_price_cents;
    return sum + per * line.qty;
  }, 0);

  const donationCents = Math.max(
    0,
    Math.round((Number.parseFloat(donationRands) || 0) * 100)
  );

  // Recompute the discount locally from the applied promo's terms so changes
  // to the cart update the total instantly. Server re-validates at /checkout.
  // The code's discount on its in-scope tickets, recomputed as the cart
  // changes. Checkout re-validates and re-computes server-side.
  const promoDiscountCents = useMemo(
    () => cartPromoDiscount(appliedPromo, Object.values(lines), ticketTypes),
    [appliedPromo, lines, ticketTypes]
  );
  // What the code skips for this cart ("Skips the waiver"), if anything.
  const promoWaivedNote = useMemo(
    () => describeWaivedForCart(appliedPromo, Object.values(lines), ticketTypes),
    [appliedPromo, lines, ticketTypes]
  );

  const totalCents =
    Math.max(0, subtotalCents - promoDiscountCents) + donationCents;

  // A 100% comp code (or any discount that zeroes the total) means
  // there's nothing to charge — the checkout API settles the order
  // inline, so the buyer never sees a payment provider.
  const isFreeOrder = totalCents <= 0;
  const lineCount = Object.values(lines).reduce((s, l) => s + l.qty, 0);

  async function applyPromo() {
    const code = promoCode.trim();
    if (!code) {
      setPromoError("Enter a code.");
      return;
    }
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/promo/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ticket_type_ids: Object.values(lines).map((l) => l.ticketTypeId),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | {
            ok: true;
            code: string;
            kind: AppliedPromo["kind"];
            percent_off: number | null;
            amount_off_cents: number | null;
            applies_to_ticket_type_id: string | null;
          }
        | { ok: false; error?: string };
      setCheckingPromo(false);
      if (!data.ok) {
        setAppliedPromo(null);
        setPromoError(data.error ?? "Couldn't apply code.");
        return;
      }
      setAppliedPromo(toPromoTerms(data));
      setPromoError(null);
    } catch {
      setCheckingPromo(false);
      setPromoError("Network error. Please try again.");
    }
  }

  function removePromo() {
    setAppliedPromo(null);
    setPromoCode("");
    setPromoError(null);
  }

  // Email always required; other fields only block checkout when enabled +
  // marked required (buyer_fields, migration 140).
  const buyerValid =
    (!bf.first_name.enabled || !bf.first_name.required || firstName.trim().length > 0) &&
    (!bf.last_name.enabled || !bf.last_name.required || lastName.trim().length > 0) &&
    (!bf.phone.enabled || !bf.phone.required || phone.trim().length > 0) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(provider: "payfast" | "stripe" | "invoice" = "payfast") {
    if (provider === "invoice" && !invoiceCountry) {
      setErr("Choose your country so we can send your invoice from the right office.");
      return;
    }
    if (lineCount === 0) {
      setErr("Add at least one pass first.");
      return;
    }
    if (!buyerValid) {
      setErr("Add your name and a valid email to lock it in.");
      document
        .getElementById("wo-buyer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (checkoutQuestions.length > 0) {
      const v = validateCheckoutAnswers(checkoutQuestions, customAnswers);
      if (!v.valid) {
        setCustomErrors(v.errors);
        setErr("Answer the required questions to lock it in.");
        document
          .getElementById("wo-buyer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setCustomErrors({});
    }
    const ticketCollect = collectTicketAnswers(ticketSlots, ticketAnswers);
    if (!ticketCollect.valid) {
      setTicketErrors(ticketCollect.errors);
      setErr("Answer the required questions for each ticket to lock it in.");
      document
        .getElementById("wo-buyer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setTicketErrors({});
    const waiverCollect = collectWaiverSignatures(waiverSlots, waiverValues);
    if (!waiverCollect.valid) {
      setWaiverErrors(waiverCollect.errors);
      setErr("Please read and sign the required form for each ticket below.");
      return;
    }
    setWaiverErrors({});
    if (!consentAccepted) {
      setErr(
        "Please accept the Ticket Purchase Terms & Consent Agreement to continue."
      );
      document
        .getElementById("wo-consent")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(provider);
    setErr(null);

    const res: Response | null = await fetch(`/api/events/${event.id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: Object.values(lines).map((l) => ({
          ticket_type_id: l.ticketTypeId,
          qty: l.qty,
          pwyw_amount_cents: l.pwywAmountCents,
        })),
        donation_cents: donationCents,
        promo_code: appliedPromo?.code ?? promoCode.trim() ?? null,
        buyer: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
        },
        marketing_consent: marketingConsent,
        consent_accepted: consentAccepted,
        custom_answers: customAnswers,
        ticket_answers: ticketCollect.payload,
        waiver_signatures: waiverCollect.payload,
        payment_provider: provider,
        ...(provider === "invoice" ? { invoice_country: invoiceCountry } : {}),
      }),
    }).catch(() => null);
    setSubmitting(null);
    // A thrown fetch (dropped mobile connection, tab suspended mid-tap) used
    // to reject out of submit() before setSubmitting(null) ran, leaving the
    // pay button disabled until the buyer reloaded the page — the "I can't
    // click pay" reports. Swallow it into a retryable error instead.
    if (!res) {
      setErr(
        "We couldn't reach the payment server. Check your connection and try again."
      );
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't start checkout. Please try again.");
      return;
    }
    const result = (await res.json().catch(() => ({}))) as {
      redirectUrl?: string;
    };
    if (result.redirectUrl) {
      window.location.href = result.redirectUrl;
      return;
    }
    setErr("Checkout returned no redirect URL.");
  }

  const dateRange =
    event.end_date && event.end_date !== event.start_date
      ? `${formatDateShort(event.start_date)}–${formatDateShort(event.end_date)}`
      : formatDateShort(event.start_date);
  const dateLong =
    event.end_date && event.end_date !== event.start_date
      ? `${formatDate(event.start_date)} → ${formatDate(event.end_date)}`
      : formatDate(event.start_date);
  const timeRange =
    event.start_time && event.end_time
      ? `${formatTime(event.start_time)}–${formatTime(event.end_time)}`
      : event.start_time
        ? formatTime(event.start_time)
        : null;

  return (
    <div
      className="wo"
      style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 50 }}
    >
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      {/* ── MASTHEAD ───────────────────────────────────────── */}
      <header className="wo-masthead">
        <div className="wo-logo">
          {/* The event's own logo wins; the MISSIŌ wordmark is the default. */}
          {event.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.logo_url} alt={event.title} className="wo-logo-img" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={MISSIO_WORDMARK_SRC}
              alt={MISSIO_WORDMARK_ALT}
              width={677}
              height={188}
              className="wo-logo-img wo-logo-word"
            />
          )}
        </div>
        <div className="wo-masthead-meta">
          <span>SENT ON MISSION</span>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="wo-hero">
        <div className="wo-hero-inner">
          <p className="wo-section-tab">CHURCH PLANT</p>
          <h1 className="wo-hero-title">{event.title}</h1>

          {event.description && (
            <EventDescription html={event.description} className="wo-hero-desc" />
          )}

          <div className="wo-coords">
            <Coord k="DATES" v={dateLong} />
            <Coord k="DOORS" v={timeRange ?? "TBA"} />
            <Coord k="VENUE" v={event.location ?? "TBA"} />
          </div>

          <a href="#wo-tickets" className="wo-hero-cta">
            GET YOUR PASS <span className="wo-cta-arrow">&rarr;</span>
          </a>
        </div>
      </section>

      {/* ── VISION ─────────────────────────────────────────── */}
      <section className="wo-vision">
        <p className="wo-section-tab">THE SENDING</p>
        <blockquote className="wo-vision-quote">
          As the Father has sent me,{" "}
          <span className="wo-hl">so I am sending you.</span>
        </blockquote>
        <p className="wo-vision-cite">
          John 20:21 — sent as he was sent, on mission wherever you go.
        </p>
      </section>

      {/* ── TICKETS ────────────────────────────────────────── */}
      <section className="wo-tickets" id="wo-tickets">
        <div className="wo-tickets-head">
          <h2 className="wo-h2">GRAB A PASS</h2>
          <p className="wo-section-tab wo-section-tab-bone">SECURE YOUR SPOT</p>
        </div>

        {visibleTickets.length === 0 ? (
          <div className="wo-empty">
            <p>NO PASSES ON SALE YET.</p>
            <span>Check back soon — the drop is coming.</span>
          </div>
        ) : (
          <div className="wo-ticket-grid">
            {visibleTickets.map((t, idx) => (
              <TicketPass
                key={t.id}
                t={t}
                idx={idx}
                now={now}
                qty={lines[t.id]?.qty ?? 0}
                pwywAmount={lines[t.id]?.pwywAmountCents ?? null}
                onQty={(n) => setQty(t, n)}
                onPwyw={(v) => setPwywAmount(t, v)}
                venue={event.location}
                dateRange={dateRange}
                currency={currency}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── EXTRAS (promo + gift) ──────────────────────────── */}
      {visibleTickets.length > 0 && (
        <section className="wo-extras">
          <div className="wo-field">
            <label className="wo-label" htmlFor="wo-promo">
              [ PROMO / COMP CODE ]
            </label>
            {appliedPromo ? (
              <div className="wo-promo-applied">
                <div className="wo-promo-applied-info">
                  <span className="wo-promo-applied-code">
                    {appliedPromo.code} APPLIED
                  </span>
                  <span className="wo-promo-applied-amount">
                    {promoDiscountCents > 0
                      ? `−${money(promoDiscountCents)} off${promoWaivedNote ? ` · ${promoWaivedNote}` : ""}`
                      : promoWaivedNote
                        ? promoWaivedNote
                        : appliedPromo.applies_to_ticket_type_id
                          ? "Add the matching tier to use this code."
                          : "No discount on the current cart."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={removePromo}
                  className="wo-promo-remove"
                  aria-label="Remove promo code"
                >
                  REMOVE ×
                </button>
              </div>
            ) : (
              <div className="wo-promo-row">
                <input
                  id="wo-promo"
                  type="text"
                  value={promoCode}
                  onChange={(e) => {
                    setPromoCode(e.target.value);
                    if (promoError) setPromoError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPromo();
                    }
                  }}
                  placeholder="ENTER CODE"
                  className="wo-input wo-input-mono"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={checkingPromo || !promoCode.trim()}
                  className="wo-promo-apply"
                >
                  {checkingPromo ? "…" : "APPLY"}
                </button>
              </div>
            )}
            {promoError && <p className="wo-promo-error">{promoError}</p>}
          </div>
          <div className="wo-field">
            <label className="wo-label" htmlFor="wo-gift">
              {`[ ADD A GIFT — ${currency} ]`}
            </label>
            <div className="wo-money-wrap">
              <span className="wo-money-prefix">R</span>
              <input
                id="wo-gift"
                type="number"
                step="0.01"
                min="0"
                value={donationRands}
                onChange={(e) => setDonationRands(e.target.value)}
                placeholder="0.00"
                className="wo-input wo-input-money"
              />
            </div>
          </div>
        </section>
      )}

      {/* ── BUYER ──────────────────────────────────────────── */}
      {lineCount > 0 && (
        <section className="wo-buyer" id="wo-buyer">
          <div className="wo-tickets-head">
            <h2 className="wo-h2 wo-h2-bone">YOUR DETAILS</h2>
            <p className="wo-section-tab">WHO&apos;S COMING</p>
          </div>
          {(bf.first_name.enabled || bf.last_name.enabled) && (
            <div className="wo-buyer-grid">
              {bf.first_name.enabled && (
                <div className="wo-field">
                  <label className="wo-label" htmlFor="wo-fn">
                    [ FIRST NAME{bf.first_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="wo-fn"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="wo-input"
                  />
                </div>
              )}
              {bf.last_name.enabled && (
                <div className="wo-field">
                  <label className="wo-label" htmlFor="wo-ln">
                    [ LAST NAME{bf.last_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="wo-ln"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="wo-input"
                  />
                </div>
              )}
            </div>
          )}
          <div className="wo-field">
            <label className="wo-label" htmlFor="wo-em">
              [ EMAIL * ]
            </label>
            <input
              id="wo-em"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="wo-input wo-input-mono"
            />
          </div>
          {bf.phone.enabled && (
            <div className="wo-field">
              <label className="wo-label" htmlFor="wo-ph">
                [ PHONE{bf.phone.required ? " *" : " — OPTIONAL"} ]
              </label>
              <PhoneInputNative
                id="wo-ph"
                value={phone}
                onChange={setPhone}
                selectClassName="wo-input"
                inputClassName="wo-input wo-input-mono"
              />
            </div>
          )}
          {checkoutQuestions.length > 0 && (
            <CheckoutQuestionFields
              questions={checkoutQuestions}
              values={customAnswers}
              errors={customErrors}
              onChange={(k, val) =>
                setCustomAnswers((prev) => ({ ...prev, [k]: val }))
              }
              classes={MISSIO_CHECKOUT_CLASSES}
            />
          )}
          {waiverSlots.length > 0 && (
            <WaiverSignatureSection
              eventId={event.id}
              slots={waiverSlots}
              valuesBySlot={waiverValues}
              errorsBySlot={waiverErrors}
              onChange={(slotKey, field, val) =>
                setWaiverValues((prev) => ({
                  ...prev,
                  [slotKey]: { ...(prev[slotKey] ?? {}), [field]: val },
                }))
              }
            />
          )}

          {ticketSlots.length > 0 && (
            <TicketQuestionsSection
              slots={ticketSlots}
              valuesBySlot={ticketAnswers}
              errorsBySlot={ticketErrors}
              onChange={(slotKey, k, val) =>
                setTicketAnswers((prev) => ({
                  ...prev,
                  [slotKey]: { ...(prev[slotKey] ?? {}), [k]: val },
                }))
              }
              classes={MISSIO_CHECKOUT_CLASSES}
              titleClassName="wo-label"
            />
          )}
          {bf.marketing_consent.enabled && (
            <label className="wo-consent">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
              />
              <span>KEEP ME IN THE LOOP — SEND ME MISSIO &amp; EVENTS BY EMAIL.</span>
            </label>
          )}
          <div
            id="wo-consent"
            className={`wo-consent-box${consentAccepted ? " is-accepted" : ""}`}
          >
            <div className="wo-consent-head">
              <span className="wo-consent-title">Required before you can pay</span>
              <span className="wo-consent-badge">
                {consentAccepted ? "✓ Accepted" : "Required"}
              </span>
            </div>
            <label className="wo-consent">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                required
              />
              <span>
                <span className="wo-consent-star">* </span>
                {TICKET_CONSENT_CHECKBOX_LABEL}{" "}
                <a
                  href={TICKET_CONSENT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the full terms.
                </a>
              </span>
            </label>
            {!consentAccepted && (
              <p className="wo-consent-warn">
                ⚠ Please tick this box to enable the payment button below.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── PAY (inline, desktop + fallback) ───────────────── */}
      {lineCount > 0 && (
        <section className="wo-pay">
          {(promoDiscountCents > 0 || donationCents > 0) && (
            <div className="wo-pay-breakdown">
              <div className="wo-pay-row">
                <span>SUBTOTAL</span>
                <span className="wo-pay-row-v">{money(subtotalCents)}</span>
              </div>
              {promoDiscountCents > 0 && (
                <div className="wo-pay-row wo-pay-row-discount">
                  <span>DISCOUNT ({appliedPromo?.code})</span>
                  <span className="wo-pay-row-v">−{money(promoDiscountCents)}</span>
                </div>
              )}
              {donationCents > 0 && (
                <div className="wo-pay-row">
                  <span>GIFT</span>
                  <span className="wo-pay-row-v">+{money(donationCents)}</span>
                </div>
              )}
            </div>
          )}
          <div className="wo-pay-total">
            <span className="wo-pay-total-k">TOTAL DUE</span>
            <span className="wo-pay-total-v">{money(totalCents)}</span>
          </div>
          <p className="wo-pay-note">
            {isFreeOrder
              ? "Your code covers this in full — nothing to pay. "
              : `Secure checkout via ${canUsePayfast ? "PayFast" : "Stripe"}. `}
            {lineCount} pass
            {lineCount === 1 ? "" : "es"} held for you.
          </p>
          {err && <p className="wo-error">{err}</p>}
          {!err && !buyerValid && (
            <p className="wo-error">
              Enter your details above — a valid email address is needed before
              the payment button turns on.
            </p>
          )}
          {isFreeOrder ? (
            <button
              type="button"
              onClick={() => submit(canUsePayfast ? "payfast" : "stripe")}
              disabled={submitting !== null || !buyerValid || !consentAccepted}
              className="wo-paybtn"
            >
              {submitting !== null ? "LOCKING IT IN…" : "GET MY PASSES"}
              {submitting === null && (
                <span className="wo-cta-arrow">&rarr;</span>
              )}
            </button>
          ) : (
            <>
            {canUsePayfast && (
              <button
                type="button"
                onClick={() => submit("payfast")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                className="wo-paybtn"
              >
                {submitting === "payfast" ? "LOCKING IT IN…" : `PAY ${money(totalCents)}`}
                {submitting !== "payfast" && <span className="wo-cta-arrow">&rarr;</span>}
              </button>
            )}
            {/* Stripe is the alternative on a ZAR event and the only
                option on any other currency, so it takes the primary
                button styling when PayFast can't be offered. */}
            <div className={canUsePayfast ? "wo-paybtn-alt-wrap" : undefined}>
              <button
                type="button"
                onClick={() => submit("stripe")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                className={canUsePayfast ? "wo-paybtn-alt" : "wo-paybtn"}
              >
                {submitting === "stripe"
                  ? "LOCKING IT IN…"
                  : canUsePayfast
                    ? "PAY WITH INTERNATIONAL CARD"
                    : `PAY ${money(totalCents)}`}
                {submitting !== "stripe" && (
                  <span className="wo-cta-arrow">&rarr;</span>
                )}
              </button>
              {canUsePayfast && (
                <p className="wo-paybtn-alt-note">
                  Card declined on PayFast? Amex / Apple&nbsp;Pay / Google&nbsp;Pay?
                  Use Stripe.
                </p>
              )}
            </div>
            {event.pay_later && (
              <div className="wo-paybtn-alt-wrap">
                <PayLaterCountry value={invoiceCountry} onChange={setInvoiceCountry} disabled={submitting !== null} />
                <button
                  type="button"
                  onClick={() => submit("invoice")}
                  disabled={submitting !== null || !buyerValid || !consentAccepted || !invoiceCountry}
                  className="wo-paybtn-alt"
                >
                  {submitting === "invoice" ? "SENDING YOUR INVOICE…" : "INVOICE ME — PAY LATER"}
                </button>
                <p className="wo-paybtn-alt-note">
                  We&apos;ll email you an invoice to pay in full or in parts. Your tickets are sent once it&apos;s fully paid.
                </p>
              </div>
            )}

            </>
          )}
        </section>
      )}

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="wo-footer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={MISSIO_WORDMARK_SRC}
          alt={MISSIO_WORDMARK_ALT}
          width={677}
          height={188}
          className="wo-footer-word"
        />
        <p className="wo-footer-vision">
          As the Father has sent me, so I am sending you. — John 20:21
        </p>
        <p className="wo-footer-meta">
          {event.title.toUpperCase()} &middot; POWERED BY FFSA HUB &middot; &copy;{" "}
          MMXXVI
        </p>
      </footer>

      {/* ── STICKY MOBILE CTA ──────────────────────────────── */}
      {lineCount > 0 && (
        <div className="wo-sticky">
          <div className="wo-sticky-info">
            <span className="wo-sticky-k">
              {lineCount} PASS{lineCount === 1 ? "" : "ES"}
            </span>
            <span className="wo-sticky-v">{money(totalCents)}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              submit(canUsePayfast ? "payfast" : "stripe")
            }
            disabled={submitting !== null}
            className="wo-sticky-btn"
          >
            {submitting !== null ? "…" : "CHECKOUT"}
            <span className="wo-cta-arrow">&rarr;</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

function Coord({ k, v }: { k: string; v: string }) {
  return (
    <div className="wo-coord">
      <span className="wo-coord-k">{k}</span>
      <span className="wo-coord-v">{v}</span>
    </div>
  );
}

function TicketPass({
  t,
  idx,
  now,
  qty,
  pwywAmount,
  onQty,
  onPwyw,
  venue,
  dateRange,
  currency,
}: {
  t: TicketType;
  idx: number;
  now: Date;
  qty: number;
  pwywAmount: number | null;
  onQty: (n: number) => void;
  onPwyw: (v: string) => void;
  venue: string | null;
  dateRange: string;
  currency: string;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  const onSale = isOnSale(t, now);
  const rem = remaining(t);
  const isPwyw = t.pricing_mode === "pwyw";
  const soldOut = rem === 0;
  // Alternate stub treatment per tier so a list of passes reads like a strip
  // of differently-stamped tickets: even = black stamp, odd = paper stamp.
  const stub = idx % 2 === 0 ? "fill" : "line";
  const serial = String(idx + 1).padStart(3, "0");

  return (
    <article
      className={`wo-pass wo-pass-${stub} ${!onSale ? "wo-pass-off" : ""} ${
        qty > 0 ? "wo-pass-active" : ""
      }`}
    >
      <div className="wo-pass-stub" aria-hidden>
        <span>ADMIT</span>
        <span>ONE</span>
        <span className="wo-pass-serial">{serial}</span>
      </div>

      <div className="wo-pass-body">
        <div className="wo-pass-top">
          <h3 className="wo-pass-name">{t.name}</h3>
          <div className="wo-pass-flags">
            {isPwyw && <span className="wo-flag wo-flag-fill">PAY WHAT YOU WANT</span>}
            {!onSale && (
              <span className="wo-flag wo-flag-line">
                {soldOut ? "SOLD OUT" : "NOT ON SALE"}
              </span>
            )}
            {onSale && rem != null && rem > 0 && rem <= 10 && (
              <span className="wo-flag wo-flag-line">ONLY {rem} LEFT</span>
            )}
          </div>
        </div>

        {t.description && <p className="wo-pass-desc">{t.description}</p>}

        <p className="wo-pass-fine">
          ADMIT ONE · {(venue ?? "TBA").toUpperCase()} · {dateRange}
        </p>

        <div className="wo-pass-foot">
          <div className="wo-pass-price">
            {isPwyw && <span className="wo-pass-price-pre">FROM</span>}
            <span className="wo-pass-price-v">{money(t.display_price_cents)}</span>
          </div>

          {onSale && !isPwyw && (
            <Stepper
              qty={qty}
              onChange={onQty}
              max={Math.min(t.max_per_order ?? 99, rem ?? 99)}
            />
          )}
          {onSale &&
            isPwyw &&
            (qty === 0 ? (
              <button type="button" className="wo-add" onClick={() => onQty(1)}>
                ADD <span className="wo-cta-arrow">&rarr;</span>
              </button>
            ) : (
              <button
                type="button"
                className="wo-add wo-add-remove"
                onClick={() => onQty(0)}
              >
                REMOVE
              </button>
            ))}
        </div>

        {isPwyw && qty > 0 && (
          <div className="wo-pwyw">
            <label className="wo-label" htmlFor={`pwyw-${t.id}`}>
              {`[ YOUR AMOUNT — ${currency} ]`}
            </label>
            <div className="wo-money-wrap">
              <span className="wo-money-prefix">R</span>
              <input
                id={`pwyw-${t.id}`}
                type="number"
                step="0.01"
                min={t.display_price_cents / 100}
                defaultValue={((pwywAmount ?? t.display_price_cents) / 100).toFixed(2)}
                onChange={(e) => onPwyw(e.target.value)}
                className="wo-input wo-input-money"
              />
            </div>
          </div>
        )}
      </div>

      {soldOut && (
        <div className="wo-soldout-band" aria-hidden>
          SOLD OUT
        </div>
      )}
    </article>
  );
}

function Stepper({
  qty,
  onChange,
  max,
}: {
  qty: number;
  onChange: (n: number) => void;
  max: number;
}) {
  return (
    <div className="wo-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
        aria-label="Remove one"
      >
        &minus;
      </button>
      <span className="wo-stepper-n">{String(qty).padStart(2, "0")}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        aria-label="Add one"
      >
        +
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${m[3]}.${m[2]}`;
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":");
  const d = new Date();
  d.setHours(Number.parseInt(h, 10), Number.parseInt(m, 10));
  return d.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ──────────────────────────────────────────────────────────────
// Scoped styles — all under `.wo` so the app's global rules don't leak
// in. LIGHT: warm off-white paper (#E2E2DD), lighter surfaces, near-black
// type and 1px rules, black primary buttons, Archivo (next/font), square
// corners (radius <= 2px), generous whitespace, no accent colour.
// ──────────────────────────────────────────────────────────────

const scopedCss = `
.wo{
  --bg:#E2E2DD; --surface:#EDEDE8; --paper:#F4F4F0;
  --ink:#111111; --muted:#4A4A46; --hair:#C9C9C2; --on-ink:#F4F4F0;
  --danger:#A3261B;
  --display:${MISSIO_FONT_FAMILY};
  --body:${MISSIO_FONT_FAMILY};
  font-family:var(--body);
  background:var(--bg);
  color:var(--ink);
  color-scheme:light;
  -webkit-font-smoothing:antialiased;
  letter-spacing:0;
}
.wo *{box-sizing:border-box;}
.wo ::selection{background:var(--ink);color:var(--on-ink);}

/* Display helper — bold geometric caps, after the MISSIŌ wordmark. */
.wo-disp{font-family:var(--display);font-weight:800;text-transform:uppercase;}

/* Reset the app's aggressive global input styling inside our scope.
   Globals use input:not([checkbox]):not([radio]):not([range]) = (0,3,1)
   with !important, so we mirror the :not() chain to out-specify it. */
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  background:var(--paper) !important;
  color:var(--ink) !important;
  border:1px solid var(--ink) !important;
  border-radius:2px !important;
  font-family:var(--body) !important;
  font-size:15px !important;
  padding:13px 14px !important;
  width:100% !important;
  text-transform:none !important;
  letter-spacing:.01em !important;
  box-shadow:none !important;
}
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"])::placeholder{
  color:var(--muted) !important;
}
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus{
  outline:none !important;
  box-shadow:0 0 0 1px var(--ink) !important;
}
.wo input.wo-input-money:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  padding-left:30px !important;
}
.wo input[type="checkbox"]{
  width:20px !important;height:20px !important;flex:0 0 20px;
  accent-color:var(--ink) !important;padding:0 !important;
  border:1px solid var(--ink) !important;border-radius:2px !important;
  background:var(--paper) !important;
}
/* Checkout-question controls — globals don't reach select/textarea, and
   the input reset above is input-only, so theme them to match. */
.wo select, .wo textarea{
  width:100%;padding:13px 14px;border-radius:2px;
  border:1px solid var(--ink);background:var(--paper);color:var(--ink);
  font-family:var(--body);font-size:15px;
  -webkit-appearance:none;-moz-appearance:none;appearance:none;
}
.wo select:focus, .wo textarea:focus{
  outline:none;box-shadow:0 0 0 1px var(--ink);
}
.wo-opt-row{
  display:flex;gap:10px;align-items:center;cursor:pointer;
  font-size:14px;letter-spacing:.01em;color:var(--ink);
}
.wo-checkout-help{
  font-size:12px;letter-spacing:.02em;margin:6px 0 0;color:var(--muted);
}

/* ── MASTHEAD ── */
.wo-masthead{
  background:var(--bg);color:var(--ink);
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:22px 24px;border-bottom:1px solid var(--ink);
}
@media(min-width:760px){.wo-masthead{padding:28px 48px;}}
.wo-logo{display:flex;align-items:center;min-width:0;}
.wo-logo-img{display:block;height:36px;width:auto;max-width:220px;object-fit:contain;}
@media(min-width:760px){.wo-logo-img{height:44px;}}
.wo-masthead-meta{
  display:none;gap:8px;align-items:center;font-size:11px;font-weight:700;
  letter-spacing:.2em;color:var(--muted);
}
@media(min-width:480px){.wo-masthead-meta{display:flex;}}

/* ── HERO ── */
.wo-hero{background:var(--bg);padding:72px 24px 88px;}
@media(min-width:760px){.wo-hero{padding:112px 48px 128px;}}
.wo-hero-inner{
  max-width:1000px;margin:0 auto;
  display:flex;flex-direction:column;align-items:flex-start;text-align:left;
}
.wo-hero-title{
  font-family:var(--display);font-weight:800;text-transform:uppercase;
  color:var(--ink);font-size:clamp(44px,10vw,112px);line-height:.92;
  letter-spacing:-.02em;margin:0;max-width:14ch;word-break:break-word;
}
.wo-hero-desc{
  margin:32px 0 0;font-size:16px;line-height:1.7;color:var(--ink);max-width:600px;
}
.wo-coords{
  margin-top:48px;display:grid;gap:0;width:100%;max-width:820px;text-align:left;
  border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);
}
@media(min-width:620px){.wo-coords{grid-template-columns:repeat(3,1fr);}}
.wo-coord{padding:16px 0;display:flex;flex-direction:column;gap:5px;}
.wo-coord + .wo-coord{border-top:1px solid var(--hair);}
@media(min-width:620px){
  .wo-coord{padding:18px 20px 18px 0;}
  .wo-coord + .wo-coord{border-top:none;border-left:1px solid var(--hair);padding-left:20px;}
}
.wo-coord-k{font-size:11px;font-weight:700;letter-spacing:.2em;color:var(--muted);}
.wo-coord-v{font-size:15px;font-weight:500;color:var(--ink);letter-spacing:.01em;}
.wo-hero-cta{
  margin-top:48px;display:inline-flex;align-items:center;gap:12px;
  background:var(--ink);color:var(--on-ink);text-decoration:none;
  font-family:var(--display);font-weight:700;
  font-size:15px;letter-spacing:.1em;text-transform:uppercase;
  padding:18px 30px;border:1px solid var(--ink);border-radius:2px;
  transition:background .15s;
}
.wo-hero-cta:hover{background:#2B2B28;}
.wo-cta-arrow{display:inline-block;transition:transform .15s;}
.wo-hero-cta:hover .wo-cta-arrow{transform:translateX(4px);}

/* ── VISION ── */
.wo-vision{
  background:var(--surface);color:var(--ink);padding:88px 24px;
  max-width:100%;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);
}
@media(min-width:760px){.wo-vision{padding:112px 48px;}}
.wo-vision > *{max-width:820px;margin-left:auto;margin-right:auto;}
.wo-section-tab{font-size:11px;font-weight:700;letter-spacing:.22em;color:var(--muted);margin:0 0 20px;}
.wo-section-tab-bone{color:var(--muted);}
.wo-vision-quote{
  font-family:var(--display);font-weight:800;text-transform:uppercase;
  font-size:clamp(30px,6vw,56px);line-height:1;margin:0;letter-spacing:-.015em;color:var(--ink);
}
.wo-hl{color:var(--ink);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.12em;}
.wo-vision-cite{
  margin:28px 0 0;font-size:14px;line-height:1.7;letter-spacing:.01em;
  color:var(--muted);max-width:560px;
}

/* ── TICKETS ── */
.wo-tickets{background:var(--bg);padding:88px 24px 72px;}
@media(min-width:760px){.wo-tickets{padding:112px 48px 88px;}}
.wo-tickets-head{margin:0 auto 40px;max-width:820px;}
.wo-h2{
  font-family:var(--display);font-weight:800;text-transform:uppercase;
  font-size:clamp(40px,9vw,80px);line-height:.92;margin:0 0 16px;color:var(--ink);letter-spacing:-.02em;
}
.wo-h2-bone{color:var(--ink);}
.wo-ticket-grid{display:grid;gap:20px;max-width:820px;margin:0 auto;}
@media(min-width:760px){.wo-ticket-grid{grid-template-columns:1fr 1fr;}}

.wo-pass{
  position:relative;display:flex;background:var(--paper);
  border:1px solid var(--ink);border-radius:2px;overflow:hidden;
  transition:box-shadow .14s ease;
}
.wo-pass:hover{box-shadow:0 0 0 1px var(--ink);}
.wo-pass-active{box-shadow:0 0 0 2px var(--ink);}
.wo-pass-off{opacity:.55;}
.wo-pass-stub{
  flex:0 0 42px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;border-right:1px solid var(--ink);
  font-family:var(--display);font-weight:700;letter-spacing:.12em;font-size:12px;
  writing-mode:vertical-rl;transform:rotate(180deg);padding:16px 0;
}
.wo-pass-serial{font-size:10px;letter-spacing:.08em;}
.wo-pass-fill .wo-pass-stub{background:var(--ink);color:var(--on-ink);}
.wo-pass-line .wo-pass-stub{background:var(--surface);color:var(--ink);}
.wo-pass-body{flex:1;padding:22px 22px 24px;min-width:0;}
.wo-pass-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.wo-pass-name{
  font-family:var(--display);font-weight:800;text-transform:uppercase;
  font-size:clamp(22px,5.5vw,30px);line-height:1;margin:0;color:var(--ink);
  letter-spacing:-.01em;word-break:break-word;
}
.wo-pass-flags{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;}
.wo-flag{
  font-family:var(--body);font-weight:700;font-size:10px;letter-spacing:.12em;
  padding:4px 8px;white-space:nowrap;text-transform:uppercase;border-radius:2px;
}
.wo-flag-fill{background:var(--ink);color:var(--on-ink);border:1px solid var(--ink);}
.wo-flag-line{background:transparent;color:var(--ink);border:1px solid var(--ink);}
.wo-pass-desc{font-size:14px;line-height:1.6;margin:12px 0 0;color:var(--muted);}
.wo-pass-fine{
  font-size:10px;font-weight:700;letter-spacing:.08em;margin:16px 0 0;color:var(--muted);
  border-top:1px solid var(--hair);padding-top:10px;text-transform:uppercase;
}
.wo-pass-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;}
.wo-pass-price{display:flex;flex-direction:column;line-height:1;}
.wo-pass-price-pre{font-size:10px;font-weight:700;letter-spacing:.2em;color:var(--muted);margin-bottom:4px;}
.wo-pass-price-v{font-family:var(--display);font-weight:800;font-size:clamp(26px,6.5vw,34px);color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em;}

.wo-stepper{display:flex;align-items:center;border:1px solid var(--ink);border-radius:2px;flex-shrink:0;background:var(--paper);}
.wo-stepper button{
  width:44px;height:44px;font-size:20px;line-height:1;background:var(--ink);color:var(--on-ink);
  border:none;cursor:pointer;transition:background .12s;font-family:var(--body);
}
.wo-stepper button:hover:not(:disabled){background:#2B2B28;}
.wo-stepper button:disabled{background:var(--hair);color:var(--muted);cursor:not-allowed;}
.wo-stepper-n{width:44px;text-align:center;font-weight:700;font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums;}

.wo-add{
  font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:.1em;
  background:var(--ink);color:var(--on-ink);border:1px solid var(--ink);border-radius:2px;
  padding:12px 18px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  transition:background .12s;flex-shrink:0;text-transform:uppercase;
}
.wo-add:hover{background:#2B2B28;}
.wo-add-remove{background:transparent;color:var(--ink);}
.wo-add-remove:hover{background:var(--surface);}
.wo-pwyw{margin-top:16px;}

.wo-soldout-band{
  position:absolute;top:22px;right:-46px;transform:rotate(38deg);
  background:var(--ink);color:var(--on-ink);font-family:var(--display);font-weight:800;
  letter-spacing:.14em;font-size:12px;padding:5px 56px;text-transform:uppercase;
}
.wo-empty{
  text-align:center;color:var(--ink);max-width:520px;margin:0 auto;
  border:1px solid var(--ink);border-radius:2px;padding:48px 24px;background:var(--surface);
}
.wo-empty p{font-family:var(--display);font-weight:800;font-size:24px;margin:0 0 10px;color:var(--ink);text-transform:uppercase;letter-spacing:-.01em;}
.wo-empty span{font-size:14px;color:var(--muted);}

/* ── EXTRAS / BUYER / PAY ── */
.wo-extras,.wo-buyer,.wo-pay{
  background:var(--bg);max-width:820px;margin:0 auto;padding:48px 24px;
}
.wo-extras{display:grid;gap:20px;border-top:1px solid var(--ink);}
@media(min-width:620px){.wo-extras{grid-template-columns:1fr 1fr;}}
.wo-buyer{border-top:1px solid var(--ink);padding-top:64px;}
.wo-buyer-grid{display:grid;gap:20px;}
@media(min-width:520px){.wo-buyer-grid{grid-template-columns:1fr 1fr;}}
.wo-field{margin-bottom:20px;}
.wo-buyer-grid .wo-field{margin-bottom:0;}
.wo-buyer-grid{margin-bottom:20px;}
.wo-label{
  display:block;font-size:11px;letter-spacing:.16em;font-weight:700;
  color:var(--ink);margin-bottom:8px;
}
.wo-input-mono{letter-spacing:.02em;}
.wo-money-wrap{position:relative;display:flex;align-items:center;}
.wo-money-prefix{
  position:absolute;left:13px;font-weight:700;color:var(--ink);font-size:15px;pointer-events:none;z-index:1;
}
.wo-consent{
  display:flex;gap:12px;align-items:flex-start;margin-top:24px;cursor:pointer;
  font-size:13px;line-height:1.6;letter-spacing:.01em;color:var(--ink);font-weight:500;
}
.wo-consent a{color:var(--ink);text-decoration:underline;}
.wo-consent-box{margin-top:24px;border:1px solid var(--ink);border-radius:2px;padding:20px;background:var(--paper);}
.wo-consent-box.is-accepted{background:var(--surface);}
.wo-consent-box .wo-consent{margin-top:0;}
.wo-consent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}
.wo-consent-title{font-family:var(--display);font-weight:800;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);}
.wo-consent-badge{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:2px;padding:4px 9px;background:var(--ink);color:var(--on-ink);border:1px solid var(--ink);}
.wo-consent-box.is-accepted .wo-consent-badge{background:transparent;color:var(--ink);}
.wo-consent-star{color:var(--ink);font-weight:800;}
.wo-consent-warn{margin:10px 0 0 32px;font-size:12px;font-weight:600;letter-spacing:.01em;color:var(--muted);}

/* ── Promo apply / applied chip ── */
.wo-promo-row{display:flex;gap:8px;align-items:stretch;}
.wo-promo-row .wo-input{flex:1;min-width:0;}
.wo-promo-apply{
  font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:.1em;
  background:var(--ink);color:var(--on-ink);border:1px solid var(--ink);border-radius:2px;
  padding:0 20px;cursor:pointer;flex-shrink:0;transition:background .12s;text-transform:uppercase;
}
.wo-promo-apply:hover:not(:disabled){background:#2B2B28;}
.wo-promo-apply:disabled{background:var(--hair);border-color:var(--hair);color:var(--muted);cursor:not-allowed;}
.wo-promo-applied{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  border:1px solid var(--ink);border-radius:2px;background:var(--paper);color:var(--ink);padding:12px 14px;
}
.wo-promo-applied-info{display:flex;flex-direction:column;gap:3px;min-width:0;}
.wo-promo-applied-code{font-family:var(--display);font-weight:800;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);}
.wo-promo-applied-amount{font-size:12px;letter-spacing:.01em;color:var(--muted);}
.wo-promo-remove{
  font-family:var(--body);font-weight:700;font-size:11px;letter-spacing:.1em;
  background:transparent;color:var(--ink);border:1px solid var(--ink);border-radius:2px;padding:6px 10px;cursor:pointer;flex-shrink:0;
}
.wo-promo-error{font-size:12px;letter-spacing:.01em;margin:8px 0 0;color:var(--danger);font-weight:600;}

/* ── PAY ── */
.wo-pay{text-align:left;padding-bottom:72px;}
.wo-pay-breakdown{border-top:1px solid var(--hair);padding:16px 0 12px;display:flex;flex-direction:column;gap:6px;}
.wo-pay-row{display:flex;align-items:baseline;justify-content:space-between;font-size:13px;font-weight:600;letter-spacing:.06em;color:var(--ink);}
.wo-pay-row-v{font-variant-numeric:tabular-nums;}
.wo-pay-row-discount{color:var(--muted);}
.wo-pay-total{
  display:flex;align-items:baseline;justify-content:space-between;
  border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);padding:20px 0;margin-bottom:16px;
}
.wo-pay-total-k{font-family:var(--display);font-weight:800;font-size:16px;letter-spacing:.12em;color:var(--ink);text-transform:uppercase;}
.wo-pay-total-v{font-family:var(--display);font-weight:800;font-size:40px;color:var(--ink);line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
.wo-pay-note{font-size:13px;font-weight:500;letter-spacing:.01em;color:var(--muted);margin:0 0 20px;}
.wo-error{background:var(--paper);color:var(--danger);border:1px solid var(--danger);border-radius:2px;padding:12px 14px;font-size:13px;font-weight:600;letter-spacing:.01em;margin:0 0 16px;}
.wo-paybtn{
  width:100%;background:var(--ink);color:var(--on-ink);border:1px solid var(--ink);border-radius:2px;
  font-family:var(--display);font-weight:800;font-size:18px;letter-spacing:.08em;
  padding:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;
  transition:background .12s;text-transform:uppercase;
}
.wo-paybtn:hover:not(:disabled){background:#2B2B28;}
.wo-paybtn:active:not(:disabled){transform:translateY(1px);}
.wo-paybtn:disabled{background:var(--hair);border-color:var(--hair);color:var(--muted);cursor:not-allowed;}

.wo-paybtn-alt-wrap{margin-top:16px;}
.wo-paybtn-alt{
  width:100%;background:transparent;color:var(--ink);border:1px solid var(--ink);border-radius:2px;
  font-family:var(--display);font-weight:700;font-size:14px;letter-spacing:.1em;
  padding:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  transition:background .12s;text-transform:uppercase;
}
.wo-paybtn-alt:hover:not(:disabled){background:var(--surface);}
.wo-paybtn-alt:disabled{color:var(--muted);border-color:var(--hair);cursor:not-allowed;}
.wo-paybtn-alt-note{text-align:center;font-size:12px;font-weight:500;letter-spacing:.01em;margin:8px 0 0;color:var(--muted);}

/* ── FOOTER ── */
.wo-footer{
  background:var(--surface);color:var(--ink);text-align:center;padding:64px 24px 128px;
  border-top:1px solid var(--ink);
}
.wo-footer-word{display:block;margin:0 auto;height:40px;width:auto;}
.wo-footer-vision{font-size:13px;font-style:italic;line-height:1.6;margin:20px auto 0;color:var(--muted);max-width:440px;}
.wo-footer-meta{font-size:10px;font-weight:700;letter-spacing:.16em;margin:16px 0 0;color:var(--muted);}

/* ── STICKY MOBILE CTA ── */
.wo-sticky{
  position:fixed;left:0;right:0;bottom:0;z-index:60;
  background:var(--paper);border-top:1px solid var(--ink);
  display:flex;align-items:stretch;gap:0;padding:0;
}
.wo-sticky-info{flex:1;display:flex;flex-direction:column;justify-content:center;padding:12px 18px;}
.wo-sticky-k{font-size:10px;font-weight:700;letter-spacing:.16em;color:var(--muted);}
.wo-sticky-v{font-family:var(--display);font-weight:800;font-size:24px;color:var(--ink);line-height:1;font-variant-numeric:tabular-nums;}
.wo-sticky-btn{
  background:var(--ink);color:var(--on-ink);border:none;
  font-family:var(--display);font-weight:800;font-size:15px;letter-spacing:.1em;
  padding:0 26px;cursor:pointer;display:flex;align-items:center;gap:9px;text-transform:uppercase;
}
.wo-sticky-btn:disabled{background:var(--hair);color:var(--muted);}
@media(min-width:760px){
  .wo-sticky{display:none;}
  .wo-footer{padding-bottom:64px;}
}

@media(prefers-reduced-motion:reduce){
  .wo *{transition:none !important;}
}
`;
