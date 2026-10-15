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

// Custom checkout questions, themed to WILD ONES' scoped `.wo-*` classes.
const WILD_ONES_CHECKOUT_CLASSES: CheckoutFieldClasses = {
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
// WILD ONES
// Bespoke ticketing landing page. Aesthetic: raw, torch-lit revival —
// charcoal paper + bone type, near-black ink, condensed Oswald caps, one
// ember-orange accent, subtle grain. All checkout state/handlers mirror
// the generic Storefront + THE SEND + FFSA Camps + PREACHERS storefronts
// exactly — only the visual layer differs.
// Slogan: "CARRY THE FIRE"
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

type AppliedPromo = {
  code: string;
  kind: "percent" | "fixed_amount" | "comp";
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
};

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

// Ember flame — decorative mark from the brand artwork.
function Flame({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M13 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1 0-2-1-3 3 1 4 4 4 6a6 6 0 0 1-12 0c0-5 5-6 6-12z" />
    </svg>
  );
}

// Bespoke WILD ONES masthead mark — a flame badge locked up with the
// condensed wordmark. A clean, crisp lockup that holds up at small size
// in the top-left corner (the real brush wordmark lives in the footer).
function WildOnesMark() {
  return (
    <span className="wo-mark" aria-label="WILD ONES">
      <svg
        className="wo-mark-badge"
        viewBox="0 0 32 32"
        aria-hidden
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect className="wo-mark-tile" x="0.75" y="0.75" width="30.5" height="30.5" rx="6" />
        <path
          className="wo-mark-flame"
          d="M17 5c1.3 5-4 6.5-4 11.5a3.4 3.4 0 0 0 6.8 0c0-1.3 0-2.6-1.3-3.9 3.9 1.3 5.2 5.2 5.2 7.8a7.7 7.7 0 0 1-15.4 0C8.3 12.8 15 11.5 17 5z"
        />
      </svg>
      <span className="wo-mark-word">WILD ONES</span>
    </span>
  );
}

export function WildOnesStorefront({
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
    for (const t of ticketTypes) m[t.id] = t.questions ?? [];
    return m;
  }, [ticketTypes]);
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
    for (const t of ticketTypes) m[t.id] = t.waiver;
    return m;
  }, [ticketTypes]);
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
  const promoDiscountCents = useMemo(() => {
    if (!appliedPromo) return 0;
    const tierIds = Object.values(lines).map((l) => l.ticketTypeId);
    if (
      appliedPromo.applies_to_ticket_type_id &&
      !tierIds.includes(appliedPromo.applies_to_ticket_type_id)
    ) {
      return 0;
    }
    if (appliedPromo.kind === "percent") {
      return Math.round((subtotalCents * (appliedPromo.percent_off ?? 0)) / 100);
    }
    if (appliedPromo.kind === "fixed_amount") {
      return Math.min(subtotalCents, appliedPromo.amount_off_cents ?? 0);
    }
    if (appliedPromo.kind === "comp") return subtotalCents;
    return 0;
  }, [appliedPromo, subtotalCents, lines]);

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
      setAppliedPromo({
        code: data.code,
        kind: data.kind,
        percent_off: data.percent_off,
        amount_off_cents: data.amount_off_cents,
        applies_to_ticket_type_id: data.applies_to_ticket_type_id,
      });
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

  const tickerItems = Array.from({ length: 8 });

  return (
    <div
      className="wo"
      style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 50 }}
    >
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      {/* ── TICKER ─────────────────────────────────────────── */}
      <div className="wo-ticker" aria-hidden>
        <div className="wo-ticker-track">
          {[0, 1].map((dup) => (
            <div className="wo-ticker-group" key={dup}>
              {tickerItems.map((_, i) => (
                <span className="wo-ticker-item" key={i}>
                  CARRY THE FIRE
                  <Flame className="wo-ticker-flame" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── MASTHEAD ───────────────────────────────────────── */}
      <header className="wo-masthead">
        <div className="wo-logo">
          <WildOnesMark />
        </div>
        <div className="wo-masthead-meta">
          <span>CONFERENCE</span>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="wo-hero">
        <div className="wo-hero-inner">
          {/* The official WILD ONES brush wordmark carries the hero. */}
          <h1 className="wo-visually-hidden">{event.title}</h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="wo-hero-art wo-hero-art-wide"
            src="/brand/wild-ones-wordmark-white.png"
            alt={event.title}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="wo-hero-art wo-hero-art-narrow"
            src="/brand/wild-ones-wordmark-white.png"
            alt={event.title}
          />

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
        <p className="wo-section-tab">THE CHARGE</p>
        <blockquote className="wo-vision-quote">
          You are the{" "}
          <span className="wo-hl">light of the world.</span>
        </blockquote>
        <p className="wo-vision-cite">
          Matthew 5:14 — lit up, sent out, and told to carry the fire wherever
          you go.
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
                      ? `−${money(promoDiscountCents)} off`
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
              classes={WILD_ONES_CHECKOUT_CLASSES}
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
              classes={WILD_ONES_CHECKOUT_CLASSES}
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
              <span>KEEP ME IN THE LOOP — SEND ME WILD ONES &amp; EVENTS BY EMAIL.</span>
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
          src="/brand/wild-ones-wordmark-white.png"
          alt="WILD ONES"
          className="wo-footer-img"
        />
        <p className="wo-footer-vision">
          You are the light of the world. — Matthew 5:14
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
  // of differently-stamped tickets: even = ember stamp, odd = bone-on-ink.
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
// Scoped styles — all under `.wo` so the app's global rules and dark
// theme don't leak in. DARK: charcoal paper, bone type, near-black ink
// chrome, condensed Oswald caps, one ember-orange accent, subtle grain.
// ──────────────────────────────────────────────────────────────

const scopedCss = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap');
.wo{
  --navy:#141210; --ink:#0B0A09; --bone:#F5F1E8;
  --offwhite:#FFFFFF; --line:#3A322C;
  --ember:#F26B21; --gold:#FF8A1E;
  --display:'Oswald','Anton','Impact','Arial Narrow Bold',sans-serif;
  --body:'Helvetica Neue',Helvetica,Arial,sans-serif;
  font-family:var(--body);
  background:var(--navy);
  color:var(--bone);
  color-scheme:dark;
  -webkit-font-smoothing:antialiased;
  letter-spacing:0;
}
.wo *{box-sizing:border-box;}
.wo ::selection{background:var(--ember);color:var(--offwhite);}

/* Subtle grain — a faint noise overlay for the gritty torch-lit feel. */
.wo::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.05;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.wo > *{position:relative;z-index:1;}

/* Display helper — condensed Oswald caps is the WILD ONES signature. */
.wo-disp{font-family:var(--display);font-weight:700;text-transform:uppercase;}

/* Ember flame — decorative separator in the "CARRY THE FIRE" ticker.
   (The masthead/footer lockups use the real WILD ONES wordmark image.) */
.wo-ticker-flame{width:11px;height:11px;display:inline-block;opacity:.9;margin:0 .55em;}

/* Reset the app's aggressive global input styling inside our scope.
   Globals use input:not([checkbox]):not([radio]):not([range]) = (0,3,1)
   with !important, so we mirror the :not() chain to out-specify it. */
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  background:var(--ink) !important;
  color:var(--offwhite) !important;
  border:2px solid var(--line) !important;
  border-radius:0 !important;
  font-family:var(--body) !important;
  font-size:15px !important;
  padding:13px 14px !important;
  width:100% !important;
  text-transform:none !important;
  letter-spacing:.02em !important;
  box-shadow:none !important;
}
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"])::placeholder{
  color:rgba(245,241,232,.4) !important;
}
.wo input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus{
  outline:none !important;
  border-color:var(--ember) !important;
  box-shadow:4px 4px 0 var(--ember) !important;
}
.wo input.wo-input-money:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  padding-left:30px !important;
}
.wo input[type="checkbox"]{
  width:20px !important;height:20px !important;flex:0 0 20px;
  accent-color:var(--ember) !important;padding:0 !important;
  border:2px solid var(--line) !important;border-radius:0 !important;
  background:var(--ink) !important;
}
/* Checkout-question controls — globals don't reach select/textarea, and
   the input reset above is input-only, so theme them to match. */
.wo select, .wo textarea{
  width:100%;padding:13px 14px;border-radius:0;
  border:2px solid var(--line);background:var(--ink);color:var(--offwhite);
  font-family:var(--body);font-size:15px;
  -webkit-appearance:none;-moz-appearance:none;appearance:none;
}
.wo select:focus, .wo textarea:focus{
  outline:none;border-color:var(--ember);box-shadow:4px 4px 0 var(--ember);
}
.wo-opt-row{
  display:flex;gap:10px;align-items:center;cursor:pointer;
  font-size:13px;letter-spacing:.02em;color:var(--bone);
}
.wo-checkout-help{
  font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--bone);opacity:.6;
}

/* ── TICKER ── */
.wo-ticker{
  background:var(--ink);border-bottom:1px solid var(--line);
  overflow:hidden;white-space:nowrap;padding:9px 0;position:relative;
}
.wo-ticker-track{display:inline-flex;animation:wo-marq 40s linear infinite;}
.wo-ticker-group{display:inline-flex;}
.wo-ticker-item{
  font-family:var(--display);font-weight:700;font-size:15px;
  letter-spacing:.22em;color:var(--ember);padding:0 .35em;
  display:inline-flex;align-items:center;text-transform:uppercase;
}
@keyframes wo-marq{from{transform:translateX(0);}to{transform:translateX(-50%);}}

/* ── MASTHEAD ── */
.wo-masthead{
  background:var(--ink);color:var(--bone);
  display:flex;align-items:center;justify-content:space-between;
  padding:15px 18px;border-bottom:1px solid var(--line);
}
/* Bespoke masthead mark — flame badge + condensed wordmark. */
.wo-mark{display:inline-flex;align-items:center;gap:9px;}
.wo-mark-badge{width:30px;height:30px;display:block;flex:0 0 auto;filter:drop-shadow(0 1px 0 rgba(0,0,0,.35));}
.wo-mark-tile{fill:var(--ember);}
.wo-mark-flame{fill:var(--offwhite);}
.wo-mark-word{
  font-family:var(--display);font-weight:700;font-size:23px;
  letter-spacing:.05em;color:var(--bone);text-transform:uppercase;line-height:1;
}
.wo-masthead-meta{
  display:none;gap:8px;align-items:center;font-size:11px;font-weight:700;
  letter-spacing:.2em;color:var(--ember);
}
@media(min-width:480px){.wo-masthead-meta{display:flex;}}

/* ── HERO ── */
.wo-hero{
  background:
    radial-gradient(120% 90% at 50% -10%, rgba(242,107,33,.22), transparent 60%),
    var(--navy);
  padding:24px 18px 48px;
}
.wo-hero-inner{
  max-width:1000px;margin:0 auto;
  display:flex;flex-direction:column;align-items:center;text-align:center;
}
.wo-visually-hidden{
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;
}
/* The official WILD ONES brush wordmark — the hero. Portrait lockup,
   capped so it reads as a centred mark rather than a giant image. */
.wo-hero-art{
  display:block;width:100%;height:auto;object-fit:contain;
}
.wo-hero-art-wide{max-width:360px;}
.wo-hero-art-narrow{max-width:260px;display:none;}
@media(max-width:759px){
  .wo-hero-art-wide{display:none;}
  .wo-hero-art-narrow{display:block;}
}
.wo-hero-desc{
  margin:26px auto 0;font-size:14px;line-height:1.7;color:var(--bone);
  max-width:560px;opacity:.82;
}
.wo-coords{
  margin-top:28px;display:grid;gap:2px;background:var(--line);
  border:2px solid var(--line);width:100%;max-width:620px;text-align:left;
}
@media(min-width:620px){.wo-coords{grid-template-columns:repeat(3,1fr);}}
.wo-coord{
  background:var(--navy);padding:12px 14px;display:flex;flex-direction:column;gap:3px;
}
.wo-coord-k{font-size:10px;font-weight:700;letter-spacing:.2em;color:var(--ember);}
.wo-coord-v{font-size:13px;color:var(--offwhite);letter-spacing:.02em;}
.wo-hero-cta{
  margin-top:30px;display:inline-flex;align-items:center;gap:11px;
  background:var(--ember);color:var(--offwhite);text-decoration:none;
  font-family:var(--display);font-weight:700;
  font-size:22px;letter-spacing:.08em;text-transform:uppercase;
  padding:15px 26px;border:2px solid var(--ember);
  box-shadow:6px 6px 0 rgba(0,0,0,.35);transition:transform .12s,box-shadow .12s;
}
.wo-hero-cta:hover{transform:translate(-2px,-2px);box-shadow:9px 9px 0 rgba(0,0,0,.35);}
.wo-cta-arrow{display:inline-block;transition:transform .15s;}
.wo-hero-cta:hover .wo-cta-arrow{transform:translateX(5px);}

/* ── VISION ── */
.wo-vision{
  background:var(--ink);color:var(--bone);padding:56px 22px;
  max-width:100%;border-top:1px solid var(--line);border-bottom:1px solid var(--line);
}
.wo-vision > *{max-width:820px;margin-left:auto;margin-right:auto;}
.wo-section-tab{font-size:11px;font-weight:700;letter-spacing:.24em;color:var(--ember);margin:0 0 16px;}
.wo-section-tab-bone{color:var(--ember);opacity:.85;}
.wo-vision-quote{
  font-family:var(--display);font-weight:700;text-transform:uppercase;
  font-size:clamp(30px,7vw,58px);line-height:.98;margin:0;letter-spacing:.01em;color:var(--offwhite);
}
.wo-hl{color:var(--ember);}
.wo-vision-cite{
  margin:24px 0 0;font-size:13px;line-height:1.7;letter-spacing:.02em;
  color:var(--bone);opacity:.72;max-width:560px;
}

/* ── TICKETS ── */
.wo-tickets{background:var(--navy);padding:52px 18px 58px;}
.wo-tickets-head{margin-bottom:28px;}
.wo-h2{
  font-family:var(--display);font-weight:700;text-transform:uppercase;
  font-size:clamp(44px,13vw,88px);line-height:.9;margin:0;color:var(--offwhite);letter-spacing:.01em;
}
.wo-h2-bone{color:var(--offwhite);}
.wo-ticket-grid{display:grid;gap:18px;max-width:820px;margin:0 auto;}
@media(min-width:760px){.wo-ticket-grid{grid-template-columns:1fr 1fr;}}

.wo-pass{
  position:relative;display:flex;background:var(--ink);
  border:2px solid var(--line);overflow:hidden;
  transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease;
}
.wo-pass:hover{transform:translateY(-3px);border-color:var(--ember);}
.wo-pass-active{border-color:var(--ember);box-shadow:7px 7px 0 rgba(0,0,0,.35);}
.wo-pass-off{opacity:.5;}
.wo-pass-stub{
  flex:0 0 42px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;border-right:2px dashed var(--line);
  font-family:var(--display);font-weight:700;letter-spacing:.1em;font-size:14px;
  writing-mode:vertical-rl;transform:rotate(180deg);padding:14px 0;
}
.wo-pass-serial{font-size:10px;opacity:.6;letter-spacing:.08em;}
.wo-pass-fill .wo-pass-stub{background:var(--ember);color:var(--offwhite);}
.wo-pass-line .wo-pass-stub{background:var(--navy);color:var(--bone);}
.wo-pass-body{flex:1;padding:18px 18px 20px;min-width:0;}
.wo-pass-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.wo-pass-name{
  font-family:var(--display);font-weight:700;text-transform:uppercase;
  font-size:clamp(24px,6.5vw,34px);line-height:.94;margin:0;color:var(--offwhite);word-break:break-word;
}
.wo-pass-flags{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;}
.wo-flag{
  font-family:var(--display);font-weight:700;font-size:12px;letter-spacing:.08em;
  padding:3px 8px;white-space:nowrap;text-transform:uppercase;
}
.wo-flag-fill{background:var(--ember);color:var(--offwhite);}
.wo-flag-line{background:transparent;color:var(--ember);border:1px solid var(--line);}
.wo-pass-desc{font-size:12px;line-height:1.6;margin:11px 0 0;color:var(--bone);opacity:.8;}
.wo-pass-fine{
  font-size:9.5px;font-weight:700;letter-spacing:.06em;margin:12px 0 0;color:var(--bone);
  opacity:.5;border-top:1px dashed var(--line);padding-top:9px;text-transform:uppercase;
}
.wo-pass-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;}
.wo-pass-price{display:flex;flex-direction:column;line-height:1;}
.wo-pass-price-pre{font-size:9px;font-weight:700;letter-spacing:.2em;color:var(--ember);margin-bottom:3px;}
.wo-pass-price-v{font-family:var(--display);font-weight:700;font-size:clamp(28px,7.5vw,38px);color:var(--offwhite);}

.wo-stepper{display:flex;align-items:center;border:2px solid var(--line);flex-shrink:0;background:var(--ink);}
.wo-stepper button{
  width:42px;height:42px;font-size:22px;line-height:1;background:var(--ember);color:var(--offwhite);
  border:none;cursor:pointer;transition:opacity .12s;font-family:var(--body);
}
.wo-stepper button:hover:not(:disabled){opacity:.82;}
.wo-stepper button:disabled{opacity:.25;cursor:not-allowed;}
.wo-stepper-n{width:44px;text-align:center;font-weight:700;font-size:16px;color:var(--offwhite);font-variant-numeric:tabular-nums;}

.wo-add{
  font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:.06em;
  background:var(--ember);color:var(--offwhite);border:2px solid var(--ember);
  padding:9px 18px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  transition:transform .12s;flex-shrink:0;text-transform:uppercase;
}
.wo-add:hover{transform:translateY(-2px);}
.wo-add-remove{background:transparent;color:var(--ember);}
.wo-pwyw{margin-top:14px;}

.wo-soldout-band{
  position:absolute;top:22px;right:-46px;transform:rotate(38deg);
  background:var(--ember);color:var(--offwhite);font-family:var(--display);font-weight:700;
  letter-spacing:.14em;font-size:15px;padding:5px 56px;text-transform:uppercase;
}
.wo-empty{
  text-align:center;color:var(--bone);max-width:520px;margin:0 auto;
  border:2px dashed var(--line);padding:40px 24px;
}
.wo-empty p{font-family:var(--display);font-weight:700;font-size:28px;margin:0 0 8px;color:var(--offwhite);text-transform:uppercase;}
.wo-empty span{font-size:12px;letter-spacing:.06em;opacity:.7;}

/* ── EXTRAS / BUYER / PAY ── */
.wo-extras,.wo-buyer,.wo-pay{
  background:var(--navy);max-width:820px;margin:0 auto;padding:36px 20px;
}
.wo-extras{display:grid;gap:18px;border-bottom:1px solid var(--line);}
@media(min-width:620px){.wo-extras{grid-template-columns:1fr 1fr;}}
.wo-buyer{border-bottom:1px solid var(--line);}
.wo-buyer-grid{display:grid;gap:16px;}
@media(min-width:520px){.wo-buyer-grid{grid-template-columns:1fr 1fr;}}
.wo-field{margin-bottom:16px;}
.wo-buyer-grid .wo-field{margin-bottom:0;}
.wo-label{
  display:block;font-size:11px;letter-spacing:.16em;font-weight:700;
  color:var(--ember);margin-bottom:7px;
}
.wo-input-mono{letter-spacing:.04em;}
.wo-money-wrap{position:relative;display:flex;align-items:center;}
.wo-money-prefix{
  position:absolute;left:13px;font-weight:700;color:var(--ember);font-size:15px;pointer-events:none;z-index:1;
}
.wo-consent{
  display:flex;gap:11px;align-items:flex-start;margin-top:20px;cursor:pointer;
  font-size:11px;line-height:1.6;letter-spacing:.04em;color:var(--bone);font-weight:700;opacity:.85;
}
.wo-consent-box{margin-top:20px;border:2px solid var(--ember);border-radius:10px;padding:16px;background:rgba(0,0,0,0.18);}
.wo-consent-box.is-accepted{border-color:rgba(245,241,232,0.25);background:rgba(0,0,0,0.10);}
.wo-consent-box .wo-consent{margin-top:0;opacity:1;}
.wo-consent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}
.wo-consent-title{font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase;color:var(--bone);}
.wo-consent-badge{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:var(--ember);color:var(--offwhite);}
.wo-consent-box.is-accepted .wo-consent-badge{background:rgba(245,241,232,0.18);color:var(--bone);}
.wo-consent-star{color:var(--ember);font-weight:800;}
.wo-consent-warn{margin:8px 0 0 27px;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--ember);}

/* ── Promo apply / applied chip ── */
.wo-promo-row{display:flex;gap:8px;align-items:stretch;}
.wo-promo-row .wo-input{flex:1;min-width:0;}
.wo-promo-apply{
  font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:.08em;
  background:var(--ember);color:var(--offwhite);border:2px solid var(--ember);
  padding:0 18px;cursor:pointer;flex-shrink:0;transition:opacity .12s;text-transform:uppercase;
}
.wo-promo-apply:hover:not(:disabled){opacity:.82;}
.wo-promo-apply:disabled{opacity:.35;cursor:not-allowed;}
.wo-promo-applied{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  border:2px solid var(--ember);background:var(--ink);color:var(--bone);padding:10px 12px;
}
.wo-promo-applied-info{display:flex;flex-direction:column;gap:2px;min-width:0;}
.wo-promo-applied-code{font-family:var(--display);font-weight:700;font-size:17px;letter-spacing:.03em;text-transform:uppercase;color:var(--ember);}
.wo-promo-applied-amount{font-size:11px;letter-spacing:.04em;opacity:.8;}
.wo-promo-remove{
  font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:.08em;
  background:transparent;color:var(--ember);border:1.5px solid var(--ember);padding:5px 9px;cursor:pointer;flex-shrink:0;
}
.wo-promo-error{font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--ember);font-weight:700;}

/* ── PAY ── */
.wo-pay{text-align:left;}
.wo-pay-breakdown{border-top:1px solid var(--line);padding:14px 0 10px;display:flex;flex-direction:column;gap:5px;}
.wo-pay-row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--bone);}
.wo-pay-row-v{font-variant-numeric:tabular-nums;}
.wo-pay-row-discount{color:var(--ember);}
.wo-pay-total{
  display:flex;align-items:baseline;justify-content:space-between;
  border-top:2px solid var(--ember);border-bottom:2px solid var(--ember);padding:16px 0;margin-bottom:14px;
}
.wo-pay-total-k{font-family:var(--display);font-weight:700;font-size:22px;letter-spacing:.1em;color:var(--offwhite);text-transform:uppercase;}
.wo-pay-total-v{font-family:var(--display);font-weight:700;font-size:42px;color:var(--offwhite);line-height:1;}
.wo-pay-note{font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--bone);opacity:.65;margin:0 0 14px;}
.wo-error{background:var(--ember);color:var(--offwhite);padding:10px 13px;font-size:12px;font-weight:700;letter-spacing:.04em;margin:0 0 14px;}
.wo-paybtn{
  width:100%;background:var(--ember);color:var(--offwhite);border:2px solid var(--ember);
  font-family:var(--display);font-weight:700;font-size:28px;letter-spacing:.03em;
  padding:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;
  box-shadow:7px 7px 0 rgba(0,0,0,.35);transition:transform .12s,box-shadow .12s;text-transform:uppercase;
}
.wo-paybtn:hover:not(:disabled){transform:translate(-2px,-2px);box-shadow:10px 10px 0 rgba(0,0,0,.35);}
.wo-paybtn:active:not(:disabled){transform:translate(2px,2px);box-shadow:3px 3px 0 rgba(0,0,0,.35);}
.wo-paybtn:disabled{opacity:.4;cursor:not-allowed;box-shadow:4px 4px 0 rgba(0,0,0,.35);}

.wo-paybtn-alt-wrap{margin-top:14px;}
.wo-paybtn-alt{
  width:100%;background:transparent;color:var(--bone);border:2px solid var(--line);
  font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:.08em;
  padding:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  transition:border-color .12s,background .12s;text-transform:uppercase;
}
.wo-paybtn-alt:hover:not(:disabled){border-color:var(--ember);background:rgba(242,107,33,.08);}
.wo-paybtn-alt:disabled{opacity:.4;cursor:not-allowed;}
.wo-paybtn-alt-note{text-align:center;font-size:10px;font-weight:700;letter-spacing:.06em;margin:7px 0 0;color:var(--bone);opacity:.6;}

/* ── FOOTER ── */
.wo-footer{
  background:var(--ink);color:var(--bone);text-align:center;padding:46px 20px 120px;
  border-top:1px solid var(--line);
}
.wo-footer-img{height:72px;width:auto;max-width:80%;object-fit:contain;display:inline-block;}
.wo-footer-vision{font-size:12px;font-style:italic;line-height:1.6;margin:16px auto 0;opacity:.85;max-width:440px;}
.wo-footer-meta{font-size:10px;font-weight:700;letter-spacing:.16em;margin:14px 0 0;opacity:.6;}

/* ── STICKY MOBILE CTA ── */
.wo-sticky{
  position:fixed;left:0;right:0;bottom:0;z-index:60;
  background:var(--ink);border-top:1px solid var(--line);
  display:flex;align-items:stretch;gap:0;padding:0;box-shadow:0 -8px 24px rgba(0,0,0,.5);
}
.wo-sticky-info{flex:1;display:flex;flex-direction:column;justify-content:center;padding:11px 16px;}
.wo-sticky-k{font-size:10px;font-weight:700;letter-spacing:.16em;color:var(--ember);}
.wo-sticky-v{font-family:var(--display);font-weight:700;font-size:26px;color:var(--offwhite);line-height:1;}
.wo-sticky-btn{
  background:var(--ember);color:var(--offwhite);border:none;
  font-family:var(--display);font-weight:700;font-size:24px;letter-spacing:.06em;
  padding:0 24px;cursor:pointer;display:flex;align-items:center;gap:9px;text-transform:uppercase;
}
.wo-sticky-btn:disabled{opacity:.6;}
@media(min-width:760px){
  .wo-sticky{display:none;}
  .wo-footer{padding-bottom:48px;}
}

@media(prefers-reduced-motion:reduce){
  .wo-ticker-track{animation:none;}
}
`;
