"use client";

import { useMemo, useState } from "react";
import { PhoneInputNative } from "@/components/ui/phone-input-native";
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
  CheckoutQuestionFields,
  type CheckoutFieldClasses,
} from "./checkout-questions-fields";
import {
  TICKET_CONSENT_URL,
  TICKET_CONSENT_CHECKBOX_LABEL,
} from "@/lib/ticketing/consent-terms";
import { TicketQuestionsSection } from "./ticket-questions-section";
import { WaiverSignatureSection } from "./waiver-signature-section";

// Custom checkout questions, themed to THE SEND's scoped `.tss-*` classes.
const SEND_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "tss-field",
  label: "tss-label",
  required: "",
  input: "tss-input",
  textarea: "tss-input",
  select: "tss-input",
  optionRow: "tss-opt-row",
  optionText: "",
  help: "tss-checkout-help",
  error: "tss-promo-error",
};

// ──────────────────────────────────────────────────────────────
// THE SEND — SOUTH AFRICA
// Bespoke ticketing landing page. Aesthetic: printed revolutionary
// broadside × Nike SB drop × Off-White industrial labelling.
// Cream paper base, navy foundation, gold signal, red urgency.
// All checkout state/handlers mirror the generic Storefront exactly —
// only the visual layer differs.
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

const ARROW = "→";

export function TheSendStorefront({
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
  const [submitting, setSubmitting] = useState<"payfast" | "stripe" | null>(null);
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
      return Math.round(
        (subtotalCents * (appliedPromo.percent_off ?? 0)) / 100
      );
    }
    if (appliedPromo.kind === "fixed_amount") {
      return Math.min(subtotalCents, appliedPromo.amount_off_cents ?? 0);
    }
    if (appliedPromo.kind === "comp") return subtotalCents;
    return 0;
  }, [appliedPromo, subtotalCents, lines]);

  const totalCents =
    Math.max(0, subtotalCents - promoDiscountCents) + donationCents;
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
        | { ok: true; code: string; kind: AppliedPromo["kind"]; percent_off: number | null; amount_off_cents: number | null; applies_to_ticket_type_id: string | null }
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

  async function submit(provider: "payfast" | "stripe" = "payfast") {
    if (lineCount === 0) {
      setErr("Add at least one ticket.");
      return;
    }
    if (!consentAccepted) {
      setErr(
        "Please accept the Ticket Purchase Terms & Consent Agreement to continue."
      );
      return;
    }
    if (!buyerValid) {
      setErr("Complete your name and a valid email to deploy.");
      document
        .getElementById("tss-buyer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (checkoutQuestions.length > 0) {
      const v = validateCheckoutAnswers(checkoutQuestions, customAnswers);
      if (!v.valid) {
        setCustomErrors(v.errors);
        setErr("Answer the required questions to deploy.");
        document
          .getElementById("tss-buyer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setCustomErrors({});
    }
    const ticketCollect = collectTicketAnswers(ticketSlots, ticketAnswers);
    if (!ticketCollect.valid) {
      setTicketErrors(ticketCollect.errors);
      setErr("Answer the required questions for each ticket to deploy.");
      document
        .getElementById("tss-buyer")
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
    setSubmitting(provider);
    setErr(null);

    const res = await fetch(`/api/events/${event.id}/checkout`, {
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
      }),
    });
    setSubmitting(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't start checkout. Please try again.");
      return;
    }
    const result = (await res.json()) as { redirectUrl?: string };
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

  const tickerWord = "THE WAR ON INACTION HAS BEGUN";
  const tickerItems = Array.from({ length: 8 });

  return (
    <div className="tss" style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 50 }}>
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      {/* ── TICKER ─────────────────────────────────────────── */}
      <div className="tss-ticker" aria-hidden>
        <div className="tss-ticker-track">
          {[0, 1].map((dup) => (
            <div className="tss-ticker-group" key={dup}>
              {tickerItems.map((_, i) => (
                <span className="tss-ticker-item" key={i}>
                  {tickerWord}
                  <span className="tss-ticker-star">{ARROW}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── MASTHEAD ───────────────────────────────────────── */}
      <header className="tss-masthead">
        <div className="tss-logo">
          {event.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.logo_url} alt="The Send" className="tss-logo-img" />
          ) : (
            <span className="tss-logo-word">
              THE SEND
              <ArrowCircle />
            </span>
          )}
        </div>
        <div className="tss-masthead-meta">
          <span>SOUTH&nbsp;AFRICA</span>
          <span className="tss-masthead-div">/</span>
          <span>MMXXVI</span>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="tss-hero">
        <div className="tss-hero-stripes" aria-hidden />
        <div className="tss-stamp" aria-hidden>
          <span>ADMIT&nbsp;ONE</span>
          <span className="tss-stamp-sub">NO.&nbsp;001/MMXXVI</span>
        </div>

        <div className="tss-hero-inner">
          <p className="tss-eyebrow tss-eyebrow-gold">
            <span className="tss-tag">&ldquo;STADIUM&nbsp;EXPERIENCE&rdquo;</span>
            <span>{dateRange}&nbsp;{ARROW}&nbsp;DURBAN&nbsp;·&nbsp;ZA</span>
          </p>

          <h1 className="tss-hero-title">
            <span className="tss-line tss-line-1">THE</span>
            <span className="tss-line tss-line-2">
              SEND<i className="tss-arrow-mark">{ARROW}</i>
            </span>
            <span className="tss-line tss-line-3">SOUTH AFRICA</span>
          </h1>

          <p className="tss-slogan">
            <i className="tss-slogan-arrow">{ARROW}</i> THE WAR ON INACTION HAS BEGUN
          </p>

          <div className="tss-coords">
            <Coord k="// DATES" v={dateLong} />
            <Coord k="// DOORS" v={timeRange ?? "12:30 PM"} />
            <Coord k="// VENUE" v={event.location ?? "Durban Christian Centre"} />
          </div>

          <a href="#tss-tickets" className="tss-hero-cta">
            CLAIM YOUR PASS <span className="tss-cta-arrow">{ARROW}</span>
          </a>
        </div>
      </section>

      {/* ── MANIFESTO ──────────────────────────────────────── */}
      <section className="tss-manifesto">
        <p className="tss-section-tab">// BRAND&nbsp;IDEA &mdash; 01</p>
        <blockquote className="tss-manifesto-quote">
          The&nbsp;Send exists to move believers from{" "}
          <span className="tss-strike">inaction</span> to a lifestyle of{" "}
          <span className="tss-hl">Christ-like action.</span>
        </blockquote>
        <p className="tss-manifesto-cite">
          {ARROW} A CATALYTIC GATHERING TO MOBILISE A GENERATION INTO THEIR
          MISSIONAL CALLING &mdash; EVERY SCHOOL, EVERY CAMPUS, EVERY NATION.
        </p>
      </section>

      {/* ── TICKETS ────────────────────────────────────────── */}
      <section className="tss-tickets" id="tss-tickets">
        <div className="tss-tickets-head">
          <h2 className="tss-h2">
            &ldquo;TICKETS&rdquo;<i className="tss-h2-arrow">{ARROW}</i>
          </h2>
          <p className="tss-section-tab tss-section-tab-light">
            // SECURE&nbsp;YOUR&nbsp;PLACE &mdash; 02
          </p>
        </div>

        {visibleTickets.length === 0 ? (
          <div className="tss-empty">
            <p>NO PASSES ON SALE YET.</p>
            <span>{ARROW} CHECK BACK SOON. THE DROP IS COMING.</span>
          </div>
        ) : (
          <div className="tss-ticket-grid">
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
        <section className="tss-extras">
          <div className="tss-field">
            <label className="tss-label" htmlFor="tss-promo">
              [ PROMO / COMP CODE ]
            </label>
            {appliedPromo ? (
              <div className="tss-promo-applied">
                <div className="tss-promo-applied-info">
                  <span className="tss-promo-applied-code">
                    {appliedPromo.code} APPLIED {ARROW}
                  </span>
                  <span className="tss-promo-applied-amount">
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
                  className="tss-promo-remove"
                  aria-label="Remove promo code"
                >
                  REMOVE ×
                </button>
              </div>
            ) : (
              <div className="tss-promo-row">
                <input
                  id="tss-promo"
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
                  className="tss-input tss-input-mono"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={checkingPromo || !promoCode.trim()}
                  className="tss-promo-apply"
                >
                  {checkingPromo ? "…" : "APPLY"}
                </button>
              </div>
            )}
            {promoError && <p className="tss-promo-error">{promoError}</p>}
          </div>
          <div className="tss-field">
            <label className="tss-label" htmlFor="tss-gift">
              {`[ ADD A GIFT — ${currency} ]`}
            </label>
            <div className="tss-money-wrap">
              <span className="tss-money-prefix">R</span>
              <input
                id="tss-gift"
                type="number"
                step="0.01"
                min="0"
                value={donationRands}
                onChange={(e) => setDonationRands(e.target.value)}
                placeholder="0.00"
                className="tss-input tss-input-money"
              />
            </div>
          </div>
        </section>
      )}

      {/* ── BUYER ──────────────────────────────────────────── */}
      {lineCount > 0 && (
        <section className="tss-buyer" id="tss-buyer">
          <div className="tss-tickets-head">
            <h2 className="tss-h2 tss-h2-navy">
              &ldquo;YOUR&nbsp;DETAILS&rdquo;
            </h2>
            <p className="tss-section-tab">// DEPLOYMENT&nbsp;DETAILS &mdash; 03</p>
          </div>
          {(bf.first_name.enabled || bf.last_name.enabled) && (
            <div className="tss-buyer-grid">
              {bf.first_name.enabled && (
                <div className="tss-field">
                  <label className="tss-label" htmlFor="tss-fn">
                    [ FIRST NAME{bf.first_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="tss-fn"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="tss-input"
                  />
                </div>
              )}
              {bf.last_name.enabled && (
                <div className="tss-field">
                  <label className="tss-label" htmlFor="tss-ln">
                    [ LAST NAME{bf.last_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="tss-ln"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="tss-input"
                  />
                </div>
              )}
            </div>
          )}
          <div className="tss-field">
            <label className="tss-label" htmlFor="tss-em">
              [ EMAIL * ]
            </label>
            <input
              id="tss-em"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="tss-input tss-input-mono"
            />
          </div>
          {bf.phone.enabled && (
            <div className="tss-field">
              <label className="tss-label" htmlFor="tss-ph">
                [ PHONE{bf.phone.required ? " *" : " — OPTIONAL"} ]
              </label>
              <PhoneInputNative
                id="tss-ph"
                value={phone}
                onChange={setPhone}
                selectClassName="tss-input"
                inputClassName="tss-input tss-input-mono"
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
              classes={SEND_CHECKOUT_CLASSES}
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
              classes={SEND_CHECKOUT_CLASSES}
              titleClassName="tss-label"
            />
          )}
          {bf.marketing_consent.enabled && (
            <label className="tss-consent">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
              />
              <span>
                KEEP ME ON THE FRONTLINE — SEND ME FFSA EVENTS &amp; GATHERINGS BY
                EMAIL.
              </span>
            </label>
          )}
          <div className={`tss-consent-box${consentAccepted ? " is-accepted" : ""}`}>
            <div className="tss-consent-head">
              <span className="tss-consent-title">Required before you can pay</span>
              <span className="tss-consent-badge">
                {consentAccepted ? "✓ Accepted" : "Required"}
              </span>
            </div>
            <label className="tss-consent">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                required
              />
              <span>
                <span className="tss-consent-star">* </span>
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
              <p className="tss-consent-warn">
                ⚠ Please tick this box to enable the payment button below.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── PAY (inline, desktop + fallback) ───────────────── */}
      {lineCount > 0 && (
        <section className="tss-pay">
          {(promoDiscountCents > 0 || donationCents > 0) && (
            <div className="tss-pay-breakdown">
              <div className="tss-pay-row">
                <span>SUBTOTAL</span>
                <span className="tss-pay-row-v">{money(subtotalCents)}</span>
              </div>
              {promoDiscountCents > 0 && (
                <div className="tss-pay-row tss-pay-row-discount">
                  <span>DISCOUNT ({appliedPromo?.code})</span>
                  <span className="tss-pay-row-v">
                    −{money(promoDiscountCents)}
                  </span>
                </div>
              )}
              {donationCents > 0 && (
                <div className="tss-pay-row">
                  <span>GIFT</span>
                  <span className="tss-pay-row-v">+{money(donationCents)}</span>
                </div>
              )}
            </div>
          )}
          <div className="tss-pay-total">
            <span className="tss-pay-total-k">TOTAL DUE</span>
            <span className="tss-pay-total-v">{money(totalCents)}</span>
          </div>
          <p className="tss-pay-note">
            {ARROW} SECURE CHECKOUT VIA {canUsePayfast ? "PAYFAST" : "STRIPE"}.{" "}
            {lineCount} PASS
            {lineCount === 1 ? "" : "ES"} HELD FOR YOU.
          </p>
          {err && <p className="tss-error">{ARROW} {err}</p>}
          {canUsePayfast && (
            <button
              type="button"
              onClick={() => submit("payfast")}
              disabled={submitting !== null || !buyerValid || !consentAccepted}
              className="tss-paybtn"
            >
              {submitting === "payfast"
                ? "DEPLOYING…"
                : `PAY ${money(totalCents)}`}
              {submitting !== "payfast" && (
                <span className="tss-cta-arrow">{ARROW}</span>
              )}
            </button>
          )}
          {/* Stripe is the alternative on a ZAR event and the only
              option on any other currency, so it takes the primary
              button styling when PayFast can't be offered. */}
          <div className={canUsePayfast ? "tss-paybtn-alt-wrap" : undefined}>
            <button
              type="button"
              onClick={() => submit("stripe")}
              disabled={submitting !== null || !buyerValid || !consentAccepted}
              className={canUsePayfast ? "tss-paybtn-alt" : "tss-paybtn"}
            >
              {submitting === "stripe"
                ? "DEPLOYING…"
                : canUsePayfast
                  ? "PAY WITH INTERNATIONAL CARD"
                  : `PAY ${money(totalCents)}`}
              {submitting !== "stripe" && (
                <span className="tss-cta-arrow">{ARROW}</span>
              )}
            </button>
            {canUsePayfast && (
              <p className="tss-paybtn-alt-note">
                {ARROW} CARD DECLINED ON PAYFAST? AMEX / APPLE&nbsp;PAY / GOOGLE&nbsp;PAY?
                USE STRIPE.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="tss-footer">
        <span className="tss-footer-word">
          THE SEND<ArrowCircle small />
        </span>
        <p className="tss-footer-meta">
          {event.title.toUpperCase()} &middot; POWERED BY FFSA HUB &middot; &copy;{" "}
          MMXXVI
        </p>
        <p className="tss-footer-fine">FOR EXTERNAL USE — DISTRIBUTE FREELY</p>
      </footer>

      {/* ── STICKY MOBILE CTA ──────────────────────────────── */}
      {lineCount > 0 && (
        <div className="tss-sticky">
          <div className="tss-sticky-info">
            <span className="tss-sticky-k">
              {lineCount} PASS{lineCount === 1 ? "" : "ES"}
            </span>
            <span className="tss-sticky-v">{money(totalCents)}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              submit(canUsePayfast ? "payfast" : "stripe")
            }
            disabled={submitting !== null}
            className="tss-sticky-btn"
          >
            {submitting !== null ? "…" : "CHECKOUT"}
            <span className="tss-cta-arrow">{ARROW}</span>
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
    <div className="tss-coord">
      <span className="tss-coord-k">{k}</span>
      <span className="tss-coord-v">{v}</span>
    </div>
  );
}

// Recreation of THE SEND circled-arrow mark: thick ring + solid right arrow.
function ArrowCircle({ small }: { small?: boolean }) {
  const s = small ? 20 : 30;
  return (
    <svg
      className="tss-arrow-circle"
      width={s}
      height={s}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
    >
      <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="8" />
      <rect x="25" y="45" width="33" height="10" fill="currentColor" />
      <path d="M53 30 L75 50 L53 70 Z" fill="currentColor" />
    </svg>
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
  // Rotate the accent colour per tier so a list of passes reads like a
  // strip of differently-stamped tickets.
  const accents = ["gold", "blue", "red", "navy"] as const;
  const accent = accents[idx % accents.length];
  const serial = String(idx + 1).padStart(3, "0");

  return (
    <article
      className={`tss-pass tss-pass-${accent} ${
        !onSale ? "tss-pass-off" : ""
      } ${qty > 0 ? "tss-pass-active" : ""}`}
    >
      <div className="tss-pass-stub" aria-hidden>
        <span>ADMIT</span>
        <span>ONE</span>
        <span className="tss-pass-serial">{serial}</span>
      </div>

      <div className="tss-pass-body">
        <div className="tss-pass-top">
          <h3 className="tss-pass-name">{t.name}</h3>
          <div className="tss-pass-flags">
            {isPwyw && <span className="tss-flag tss-flag-gold">PAY WHAT YOU WANT</span>}
            {!onSale && (
              <span className="tss-flag tss-flag-red">
                {soldOut ? "SOLD OUT" : "NOT ON SALE"}
              </span>
            )}
            {onSale && rem != null && rem > 0 && rem <= 10 && (
              <span className="tss-flag tss-flag-red">ONLY {rem} LEFT</span>
            )}
          </div>
        </div>

        {t.description && <p className="tss-pass-desc">{t.description}</p>}

        <p className="tss-pass-fine">
          {ARROW} ADMIT ONE · {venue ?? "DURBAN CHRISTIAN CENTRE"} · {dateRange}
        </p>

        <div className="tss-pass-foot">
          <div className="tss-pass-price">
            {isPwyw && <span className="tss-pass-price-pre">FROM</span>}
            <span className="tss-pass-price-v">{money(t.display_price_cents)}</span>
          </div>

          {onSale && !isPwyw && (
            <Stepper
              qty={qty}
              onChange={onQty}
              max={Math.min(t.max_per_order ?? 99, rem ?? 99)}
            />
          )}
          {onSale && isPwyw && (
            qty === 0 ? (
              <button type="button" className="tss-add" onClick={() => onQty(1)}>
                ADD <span className="tss-cta-arrow">{ARROW}</span>
              </button>
            ) : (
              <button
                type="button"
                className="tss-add tss-add-remove"
                onClick={() => onQty(0)}
              >
                REMOVE
              </button>
            )
          )}
        </div>

        {isPwyw && qty > 0 && (
          <div className="tss-pwyw">
            <label className="tss-label" htmlFor={`pwyw-${t.id}`}>
              {`[ YOUR AMOUNT — ${currency} ]`}
            </label>
            <div className="tss-money-wrap">
              <span className="tss-money-prefix">R</span>
              <input
                id={`pwyw-${t.id}`}
                type="number"
                step="0.01"
                min={t.display_price_cents / 100}
                defaultValue={(
                  (pwywAmount ?? t.display_price_cents) / 100
                ).toFixed(2)}
                onChange={(e) => onPwyw(e.target.value)}
                className="tss-input tss-input-money"
              />
            </div>
          </div>
        )}
      </div>

      {soldOut && <div className="tss-soldout-band" aria-hidden>SOLD OUT</div>}
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
    <div className="tss-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
        aria-label="Remove one"
      >
        &minus;
      </button>
      <span className="tss-stepper-n">{String(qty).padStart(2, "0")}</span>
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
// Scoped styles — all under `.tss` so the app's global rules and
// dark theme don't leak in. Cream paper base, light color-scheme.
// ──────────────────────────────────────────────────────────────

const scopedCss = `
.tss{
  --gold:#FACF50; --cream:#F7F1E8; --red:#FA0015;
  --blue:#1535C6; --navy:#1C314C; --ink:#0E1A2B;
  --paper:#F7F1E8;
  font-family:var(--font-space-mono),ui-monospace,monospace;
  background:var(--paper);
  color:var(--navy);
  color-scheme:light;
  -webkit-font-smoothing:antialiased;
  letter-spacing:0;
}
.tss *{box-sizing:border-box;}
.tss ::selection{background:var(--gold);color:var(--navy);}

/* Reset the app's aggressive global input styling inside our scope.
   Globals use input:not([checkbox]):not([radio]):not([range]) = (0,3,1)
   with !important, so we mirror the :not() chain to out-specify it. */
.tss input:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  background:var(--navy) !important;
  color:var(--cream) !important;
  border:2px solid var(--navy) !important;
  border-radius:0 !important;
  font-family:var(--font-space-mono),monospace !important;
  font-size:15px !important;
  padding:13px 14px !important;
  width:100% !important;
  text-transform:none !important;
  letter-spacing:.02em !important;
  box-shadow:none !important;
}
.tss input:not([type="checkbox"]):not([type="radio"]):not([type="range"])::placeholder{
  color:rgba(247,241,232,.45) !important;
}
.tss input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus{
  outline:none !important;
  border-color:var(--gold) !important;
  background:var(--ink) !important;
  box-shadow:4px 4px 0 var(--gold) !important;
}
.tss input.tss-input-money:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  padding-left:30px !important;
}
.tss input[type="checkbox"]{
  width:20px !important;height:20px !important;flex:0 0 20px;
  accent-color:var(--gold) !important;padding:0 !important;
  border:2px solid var(--navy) !important;border-radius:0 !important;
  background:var(--navy) !important;
}
/* Checkout-question controls — globals don't reach select/textarea, and
   the input reset above is input-only, so theme them to match. */
.tss select, .tss textarea{
  width:100%;padding:13px 14px;border-radius:0;
  border:2px solid var(--navy);background:var(--navy);color:var(--cream);
  font-family:var(--font-space-mono),monospace;font-size:15px;
  -webkit-appearance:none;-moz-appearance:none;appearance:none;
}
.tss select:focus, .tss textarea:focus{
  outline:none;border-color:var(--gold);background:var(--ink);box-shadow:4px 4px 0 var(--gold);
}
.tss-opt-row{
  display:flex;gap:10px;align-items:center;cursor:pointer;
  font-size:13px;letter-spacing:.02em;color:var(--navy);
}
.tss-checkout-help{
  font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--navy);opacity:.65;
}

/* ── TICKER ── */
.tss-ticker{
  background:var(--gold);border-bottom:3px solid var(--navy);
  overflow:hidden;white-space:nowrap;padding:7px 0;position:relative;
}
.tss-ticker-track{display:inline-flex;animation:tss-marq 38s linear infinite;}
.tss-ticker-group{display:inline-flex;}
.tss-ticker-item{
  font-family:var(--font-bebas),sans-serif;font-size:15px;
  letter-spacing:.14em;color:var(--navy);padding:0 .35em;
  display:inline-flex;align-items:center;
}
.tss-ticker-star{color:var(--red);font-weight:700;padding:0 .55em;font-size:13px;}
@keyframes tss-marq{from{transform:translateX(0);}to{transform:translateX(-50%);}}

/* ── MASTHEAD ── */
.tss-masthead{
  background:var(--navy);color:var(--cream);
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 18px;border-bottom:1px solid rgba(247,241,232,.16);
}
.tss-logo-word{
  font-family:"Arial Black","Arial Bold",Arial,sans-serif;font-weight:900;
  font-size:22px;letter-spacing:-.01em;white-space:nowrap;
  color:var(--gold);display:inline-flex;align-items:center;gap:11px;line-height:1;
}
.tss-logo-img{height:30px;width:auto;object-fit:contain;}
.tss-arrow-circle{color:var(--gold);}
.tss-masthead-meta{
  display:none;gap:8px;align-items:center;font-size:11px;letter-spacing:.18em;
  color:var(--cream);opacity:.85;
}
@media(min-width:480px){.tss-masthead-meta{display:flex;}}
.tss-masthead-div{color:var(--gold);}

/* ── HERO ── */
.tss-hero{
  position:relative;background:var(--navy);color:var(--cream);
  padding:46px 20px 54px;overflow:hidden;
}
.tss-hero-stripes{
  position:absolute;top:0;left:0;width:46px;height:100%;
  background:repeating-linear-gradient(45deg,var(--gold) 0 12px,var(--navy) 12px 24px);
  opacity:.9;border-right:2px solid var(--gold);
}
.tss-stamp{
  position:absolute;top:26px;right:14px;transform:rotate(7deg);
  border:2.5px solid var(--red);color:var(--red);
  padding:7px 11px;text-align:center;line-height:1.05;
  font-family:var(--font-bebas),sans-serif;letter-spacing:.12em;
  display:flex;flex-direction:column;gap:2px;opacity:.92;
}
.tss-stamp span{font-size:17px;}
.tss-stamp-sub{font-size:9px !important;letter-spacing:.16em;opacity:.85;}
.tss-hero-inner{position:relative;max-width:760px;margin:0 auto;padding-left:38px;}
.tss-eyebrow{
  display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;
  font-size:11px;letter-spacing:.2em;margin:0 0 22px;
}
.tss-eyebrow-gold{color:var(--gold);}
.tss-tag{
  background:var(--gold);color:var(--navy);padding:3px 8px;font-weight:700;
  letter-spacing:.12em;
}
.tss-hero-title{
  font-family:var(--font-anton),sans-serif;margin:0;line-height:.84;
  text-transform:uppercase;
}
.tss-line{display:block;}
.tss-line-1{font-size:clamp(54px,17vw,118px);color:var(--cream);}
.tss-line-2{
  font-size:clamp(74px,23vw,168px);color:var(--gold);
  display:flex;align-items:flex-start;gap:.06em;
}
.tss-arrow-mark{
  font-style:normal;font-size:.42em;color:var(--red);
  -webkit-text-stroke:0;margin-top:.18em;
  animation:tss-nudge 1.8s ease-in-out infinite;
}
@keyframes tss-nudge{0%,100%{transform:translateX(0);}50%{transform:translateX(.18em);}}
.tss-line-3{
  font-family:var(--font-bebas),sans-serif;font-size:clamp(26px,7vw,52px);
  color:var(--cream);letter-spacing:.04em;margin-top:.12em;
}
.tss-slogan{
  font-family:var(--font-bebas),sans-serif;color:var(--cream);
  background:var(--red);display:inline-flex;align-items:center;gap:.4em;
  font-size:clamp(15px,4.4vw,22px);letter-spacing:.1em;
  padding:7px 14px;margin:22px 0 0;
}
.tss-slogan-arrow{font-style:normal;color:var(--gold);}
.tss-coords{
  margin-top:30px;display:grid;gap:1px;background:rgba(247,241,232,.18);
  border:1px solid rgba(247,241,232,.18);
}
.tss-coord{
  background:var(--navy);padding:11px 13px;display:flex;flex-direction:column;gap:3px;
}
.tss-coord-k{font-size:10px;letter-spacing:.18em;color:var(--gold);}
.tss-coord-v{font-size:13px;color:var(--cream);letter-spacing:.02em;}
.tss-hero-cta{
  margin-top:30px;display:inline-flex;align-items:center;gap:11px;
  background:var(--gold);color:var(--navy);text-decoration:none;
  font-family:var(--font-bebas),sans-serif;font-size:21px;letter-spacing:.1em;
  padding:13px 22px;border:2px solid var(--navy);
  box-shadow:6px 6px 0 var(--red);transition:transform .12s,box-shadow .12s;
}
.tss-hero-cta:hover{transform:translate(-2px,-2px);box-shadow:9px 9px 0 var(--red);}
.tss-cta-arrow{display:inline-block;transition:transform .15s;}
.tss-hero-cta:hover .tss-cta-arrow{transform:translateX(5px);}

/* ── MANIFESTO ── */
.tss-manifesto{
  background:var(--cream);color:var(--navy);padding:54px 22px;
  max-width:820px;margin:0 auto;
  border-bottom:3px solid var(--navy);
}
.tss-section-tab{font-size:11px;letter-spacing:.22em;color:var(--blue);margin:0 0 16px;font-weight:700;}
.tss-section-tab-light{color:var(--gold);}
.tss-manifesto-quote{
  font-family:var(--font-anton),sans-serif;text-transform:uppercase;
  font-size:clamp(28px,7vw,52px);line-height:.98;margin:0;letter-spacing:.005em;
}
.tss-strike{text-decoration:line-through;text-decoration-color:var(--red);text-decoration-thickness:4px;opacity:.55;}
.tss-hl{color:var(--blue);}
.tss-manifesto-cite{
  margin:24px 0 0;font-size:12px;line-height:1.7;letter-spacing:.08em;
  color:var(--navy);opacity:.78;max-width:560px;
}

/* ── TICKETS ── */
.tss-tickets{background:var(--navy);padding:48px 18px 56px;}
.tss-tickets-head{margin-bottom:26px;}
.tss-h2{
  font-family:var(--font-anton),sans-serif;text-transform:uppercase;
  font-size:clamp(40px,12vw,84px);line-height:.86;margin:0;color:var(--gold);
  display:flex;align-items:flex-start;gap:.1em;
}
.tss-h2-navy{color:var(--navy);}
.tss-h2-arrow{font-style:normal;color:var(--red);font-size:.5em;margin-top:.1em;}
.tss-ticket-grid{
  display:grid;gap:18px;max-width:780px;margin:0 auto;
}
@media(min-width:760px){.tss-ticket-grid{grid-template-columns:1fr 1fr;}}

.tss-pass{
  position:relative;display:flex;background:var(--cream);
  border:3px solid var(--navy);overflow:hidden;
  transition:transform .14s ease,box-shadow .14s ease;
}
.tss-pass:hover{transform:translateY(-3px) rotate(-.4deg);box-shadow:0 14px 0 -4px rgba(0,0,0,.25);}
.tss-pass-active{box-shadow:7px 7px 0 var(--gold);}
.tss-pass-off{opacity:.62;}
.tss-pass-stub{
  flex:0 0 40px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;
  border-right:3px dashed var(--navy);
  font-family:var(--font-bebas),sans-serif;letter-spacing:.16em;font-size:13px;
  writing-mode:vertical-rl;transform:rotate(180deg);
  padding:14px 0;
}
.tss-pass-serial{font-size:10px;opacity:.6;letter-spacing:.1em;}
.tss-pass-gold .tss-pass-stub{background:var(--gold);color:var(--navy);}
.tss-pass-blue .tss-pass-stub{background:var(--blue);color:var(--cream);}
.tss-pass-red .tss-pass-stub{background:var(--red);color:var(--cream);}
.tss-pass-navy .tss-pass-stub{background:var(--navy);color:var(--gold);}
.tss-pass-body{flex:1;padding:18px 18px 20px;min-width:0;}
.tss-pass-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.tss-pass-name{
  font-family:var(--font-anton),sans-serif;text-transform:uppercase;
  font-size:clamp(22px,6vw,34px);line-height:.9;margin:0;color:var(--navy);
  word-break:break-word;
}
.tss-pass-flags{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;}
.tss-flag{
  font-family:var(--font-bebas),sans-serif;font-size:11px;letter-spacing:.1em;
  padding:3px 7px;white-space:nowrap;
}
.tss-flag-gold{background:var(--gold);color:var(--navy);}
.tss-flag-red{background:var(--red);color:#fff;}
.tss-pass-desc{font-size:12px;line-height:1.6;margin:11px 0 0;color:var(--navy);opacity:.82;}
.tss-pass-fine{
  font-size:9.5px;letter-spacing:.07em;margin:12px 0 0;color:var(--navy);
  opacity:.55;border-top:1px dashed rgba(28,49,76,.4);padding-top:9px;
  text-transform:uppercase;
}
.tss-pass-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;}
.tss-pass-price{display:flex;flex-direction:column;line-height:1;}
.tss-pass-price-pre{font-size:9px;letter-spacing:.2em;color:var(--blue);margin-bottom:3px;}
.tss-pass-price-v{font-family:var(--font-anton),sans-serif;font-size:clamp(26px,7vw,38px);color:var(--navy);}

.tss-stepper{display:flex;align-items:center;border:2.5px solid var(--navy);flex-shrink:0;background:#fff;}
.tss-stepper button{
  width:42px;height:42px;font-size:22px;line-height:1;background:var(--navy);color:var(--cream);
  border:none;cursor:pointer;transition:background .12s;font-family:var(--font-space-mono),monospace;
}
.tss-stepper button:hover:not(:disabled){background:var(--blue);}
.tss-stepper button:disabled{opacity:.3;cursor:not-allowed;}
.tss-stepper-n{width:44px;text-align:center;font-weight:700;font-size:16px;color:var(--navy);font-variant-numeric:tabular-nums;}

.tss-add{
  font-family:var(--font-bebas),sans-serif;font-size:18px;letter-spacing:.08em;
  background:var(--blue);color:#fff;border:2.5px solid var(--navy);
  padding:9px 17px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  transition:transform .12s;flex-shrink:0;
}
.tss-add:hover{transform:translateY(-2px);}
.tss-add-remove{background:transparent;color:var(--navy);}
.tss-pwyw{margin-top:14px;}

.tss-soldout-band{
  position:absolute;top:22px;right:-46px;transform:rotate(38deg);
  background:var(--red);color:#fff;font-family:var(--font-bebas),sans-serif;
  letter-spacing:.18em;font-size:15px;padding:5px 56px;
}
.tss-empty{
  text-align:center;color:var(--cream);max-width:520px;margin:0 auto;
  border:2px dashed rgba(247,241,232,.4);padding:40px 24px;
}
.tss-empty p{font-family:var(--font-anton),sans-serif;font-size:26px;margin:0 0 8px;color:var(--gold);}
.tss-empty span{font-size:12px;letter-spacing:.12em;opacity:.8;}

/* ── EXTRAS / BUYER ── */
.tss-extras,.tss-buyer,.tss-pay{
  background:var(--cream);max-width:780px;margin:0 auto;padding:34px 20px;
}
.tss-extras{display:grid;gap:18px;border-bottom:3px solid var(--navy);}
@media(min-width:620px){.tss-extras{grid-template-columns:1fr 1fr;}}
.tss-buyer{border-bottom:3px solid var(--navy);}
.tss-buyer-grid{display:grid;gap:16px;}
@media(min-width:520px){.tss-buyer-grid{grid-template-columns:1fr 1fr;}}
.tss-field{margin-bottom:16px;}
.tss-buyer-grid .tss-field{margin-bottom:0;}
.tss-label{
  display:block;font-size:11px;letter-spacing:.16em;font-weight:700;
  color:var(--navy);margin-bottom:7px;
}
.tss-input-mono{letter-spacing:.04em;}
.tss-money-wrap{position:relative;display:flex;align-items:center;}
.tss-money-prefix{
  position:absolute;left:13px;font-weight:700;color:var(--gold);font-size:15px;pointer-events:none;z-index:1;
}
.tss-input-money{padding-left:30px !important;}
.tss-consent{
  display:flex;gap:11px;align-items:flex-start;margin-top:20px;cursor:pointer;
  font-size:11px;line-height:1.6;letter-spacing:.06em;color:var(--navy);
}
.tss-consent-box{margin-top:20px;border:2px solid var(--navy);border-radius:10px;padding:16px;background:rgba(28,49,76,0.03);}
.tss-consent-box.is-accepted{border-color:rgba(28,49,76,0.2);background:transparent;}
.tss-consent-box .tss-consent{margin-top:0;}
.tss-consent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}
.tss-consent-title{font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--navy);}
.tss-consent-badge{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:var(--navy);color:var(--cream);}
.tss-consent-box.is-accepted .tss-consent-badge{background:rgba(28,49,76,0.12);color:var(--navy);}
.tss-consent-star{color:var(--red);font-weight:800;}
.tss-consent-warn{margin:8px 0 0 27px;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--red);}

/* ── Promo apply / applied chip ── */
.tss-promo-row{display:flex;gap:8px;align-items:stretch;}
.tss-promo-row .tss-input{flex:1;min-width:0;}
.tss-promo-apply{
  font-family:var(--font-bebas),sans-serif;font-size:15px;letter-spacing:.1em;
  background:var(--navy);color:var(--gold);border:2px solid var(--navy);
  padding:0 16px;cursor:pointer;flex-shrink:0;
  transition:transform .12s;
}
.tss-promo-apply:hover:not(:disabled){background:var(--blue);border-color:var(--blue);color:var(--cream);}
.tss-promo-apply:disabled{opacity:.4;cursor:not-allowed;}
.tss-promo-applied{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  border:2px solid var(--navy);background:var(--gold);color:var(--navy);
  padding:10px 12px;
}
.tss-promo-applied-info{display:flex;flex-direction:column;gap:2px;min-width:0;}
.tss-promo-applied-code{
  font-family:var(--font-anton),sans-serif;font-size:16px;letter-spacing:.04em;
  text-transform:uppercase;
}
.tss-promo-applied-amount{font-size:11px;letter-spacing:.04em;opacity:.85;}
.tss-promo-remove{
  font-family:var(--font-bebas),sans-serif;font-size:12px;letter-spacing:.12em;
  background:transparent;color:var(--navy);border:1.5px solid var(--navy);
  padding:5px 9px;cursor:pointer;flex-shrink:0;
}
.tss-promo-error{font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--red);}

/* ── PAY ── */
.tss-pay{text-align:left;}
.tss-pay-breakdown{
  border-top:3px solid var(--navy);padding:14px 0 10px;display:flex;flex-direction:column;gap:5px;
}
.tss-pay-row{
  display:flex;align-items:baseline;justify-content:space-between;
  font-size:12px;letter-spacing:.1em;color:var(--navy);
}
.tss-pay-row-v{font-variant-numeric:tabular-nums;}
.tss-pay-row-discount{color:var(--red);}
.tss-pay-row-discount span:first-child{font-weight:700;}
.tss-pay-total{
  display:flex;align-items:baseline;justify-content:space-between;
  border-top:3px solid var(--navy);border-bottom:3px solid var(--navy);
  padding:16px 0;margin-bottom:14px;
}
.tss-pay-total-k{font-family:var(--font-bebas),sans-serif;font-size:20px;letter-spacing:.14em;color:var(--navy);}
.tss-pay-total-v{font-family:var(--font-anton),sans-serif;font-size:40px;color:var(--blue);line-height:1;}
.tss-pay-note{font-size:11px;letter-spacing:.08em;color:var(--navy);opacity:.7;margin:0 0 14px;}
.tss-error{
  background:var(--red);color:#fff;padding:10px 13px;font-size:12px;letter-spacing:.04em;
  margin:0 0 14px;
}
.tss-paybtn{
  width:100%;background:var(--red);color:#fff;border:3px solid var(--navy);
  font-family:var(--font-anton),sans-serif;font-size:26px;letter-spacing:.04em;
  padding:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;
  box-shadow:7px 7px 0 var(--navy);transition:transform .12s,box-shadow .12s;
  text-transform:uppercase;
}
.tss-paybtn:hover:not(:disabled){transform:translate(-2px,-2px);box-shadow:10px 10px 0 var(--navy);}
.tss-paybtn:active:not(:disabled){transform:translate(2px,2px);box-shadow:3px 3px 0 var(--navy);}
.tss-paybtn:disabled{opacity:.45;cursor:not-allowed;box-shadow:4px 4px 0 var(--navy);}

.tss-paybtn-alt-wrap{margin-top:14px;}
.tss-paybtn-alt{
  width:100%;background:transparent;color:var(--navy);border:2.5px solid var(--navy);
  font-family:var(--font-bebas),sans-serif;font-size:17px;letter-spacing:.1em;
  padding:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  transition:background .12s,color .12s;
}
.tss-paybtn-alt:hover:not(:disabled){background:var(--navy);color:var(--gold);}
.tss-paybtn-alt:disabled{opacity:.45;cursor:not-allowed;}
.tss-paybtn-alt-note{
  text-align:center;font-size:10px;letter-spacing:.1em;margin:7px 0 0;
  color:var(--navy);opacity:.7;
}

/* ── FOOTER ── */
.tss-footer{background:var(--navy);color:var(--cream);text-align:center;padding:40px 20px 120px;}
.tss-footer-word{
  font-family:"Arial Black","Arial Bold",Arial,sans-serif;font-weight:900;
  font-size:27px;letter-spacing:-.01em;color:var(--gold);
  display:inline-flex;align-items:center;gap:10px;
}
.tss-footer-meta{font-size:10px;letter-spacing:.16em;margin:14px 0 0;opacity:.8;}
.tss-footer-fine{font-size:9px;letter-spacing:.22em;margin:8px 0 0;color:var(--gold);opacity:.6;}

/* ── STICKY MOBILE CTA ── */
.tss-sticky{
  position:fixed;left:0;right:0;bottom:0;z-index:60;
  background:var(--navy);border-top:3px solid var(--gold);
  display:flex;align-items:stretch;gap:0;
  padding:0;box-shadow:0 -8px 24px rgba(0,0,0,.3);
}
.tss-sticky-info{
  flex:1;display:flex;flex-direction:column;justify-content:center;padding:11px 16px;
}
.tss-sticky-k{font-size:10px;letter-spacing:.16em;color:var(--gold);}
.tss-sticky-v{font-family:var(--font-anton),sans-serif;font-size:24px;color:var(--cream);line-height:1;}
.tss-sticky-btn{
  background:var(--gold);color:var(--navy);border:none;
  font-family:var(--font-bebas),sans-serif;font-size:22px;letter-spacing:.08em;
  padding:0 24px;cursor:pointer;display:flex;align-items:center;gap:9px;
}
.tss-sticky-btn:disabled{opacity:.6;}
@media(min-width:760px){
  .tss-sticky{display:none;}
  .tss-footer{padding-bottom:48px;}
}

@media(prefers-reduced-motion:reduce){
  .tss-ticker-track{animation:none;}
  .tss-arrow-mark{animation:none;}
}
`;
