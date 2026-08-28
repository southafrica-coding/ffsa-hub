"use client";

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
  CheckoutQuestionFields,
  type CheckoutFieldClasses,
} from "./checkout-questions-fields";
import {
  TICKET_CONSENT_URL,
  TICKET_CONSENT_CHECKBOX_LABEL,
} from "@/lib/ticketing/consent-terms";
import { TicketQuestionsSection } from "./ticket-questions-section";
import { WaiverSignatureSection } from "./waiver-signature-section";

// Custom checkout questions, themed to FFSA Camps' scoped `.cmp-*` classes.
const CAMPS_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "cmp-field",
  label: "cmp-label",
  required: "",
  input: "cmp-input",
  textarea: "cmp-input",
  select: "cmp-input",
  optionRow: "cmp-opt-row",
  optionText: "",
  help: "cmp-checkout-help",
  error: "cmp-promo-error",
};

// ──────────────────────────────────────────────────────────────
// FFSA CAMPS
// Bespoke ticketing landing page. Aesthetic: clean + youthful edge —
// bright blue + cream, dot-grid texture, a thick blue frame (from the
// brand kit), heavy *italic* display type, GenZ voice. All checkout
// state/handlers mirror the generic Storefront + THE SEND storefront
// exactly — only the visual layer differs.
// Slogan: "PERMISSION GRANTED".
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

const STAR = "✦"; // ✦ — brand mark used as a separator

export function CampsStorefront({
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

  async function submit(provider: "payfast" | "stripe" = "payfast") {
    if (lineCount === 0) {
      setErr("Add at least one pass first.");
      return;
    }
    if (!consentAccepted) {
      setErr(
        "Please accept the Ticket Purchase Terms & Consent Agreement to continue."
      );
      return;
    }
    if (!buyerValid) {
      setErr("Pop in your name and a valid email to lock it in.");
      document
        .getElementById("cmp-buyer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (checkoutQuestions.length > 0) {
      const v = validateCheckoutAnswers(checkoutQuestions, customAnswers);
      if (!v.valid) {
        setCustomErrors(v.errors);
        setErr("Answer the required questions to lock it in.");
        document
          .getElementById("cmp-buyer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setCustomErrors({});
    }
    const ticketCollect = collectTicketAnswers(ticketSlots, ticketAnswers);
    if (!ticketCollect.valid) {
      setTicketErrors(ticketCollect.errors);
      setErr("Answer the required questions for each pass to lock it in.");
      document
        .getElementById("cmp-buyer")
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

  const tickerWord = "PERMISSION GRANTED";
  const tickerItems = Array.from({ length: 8 });

  return (
    <div
      className="cmp"
      style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 50 }}
    >
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      {/* ── TICKER ─────────────────────────────────────────── */}
      <div className="cmp-ticker" aria-hidden>
        <div className="cmp-ticker-track">
          {[0, 1].map((dup) => (
            <div className="cmp-ticker-group" key={dup}>
              {tickerItems.map((_, i) => (
                <span className="cmp-ticker-item" key={i}>
                  {tickerWord}
                  <span className="cmp-ticker-star">{STAR}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── MASTHEAD ───────────────────────────────────────── */}
      <header className="cmp-masthead">
        <div className="cmp-logo">
          {event.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.logo_url} alt="FFSA Camps" className="cmp-logo-img" />
          ) : (
            <span className="cmp-logo-word">FFSA CAMPS</span>
          )}
        </div>
        <div className="cmp-masthead-meta">
          <span>SOUTH&nbsp;AFRICA</span>
          <span className="cmp-masthead-div">/</span>
          <span>MMXXVI</span>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="cmp-hero">
        <div className="cmp-hero-frame">
          <p className="cmp-eyebrow">
            <span className="cmp-tag">FFSA&nbsp;CAMPS</span>
            <span>
              {dateRange}&nbsp;{STAR}&nbsp;{(event.location ?? "SOUTH AFRICA").toUpperCase()}
            </span>
          </p>

          <h1 className="cmp-hero-title">{event.title}</h1>

          <p className="cmp-slogan">PERMISSION GRANTED &#129310;</p>

          {event.description && (
            <EventDescription html={event.description} className="cmp-hero-desc" />
          )}

          <div className="cmp-coords">
            <Coord k="DATES" v={dateLong} />
            <Coord k="DOORS" v={timeRange ?? "TBA"} />
            <Coord k="VENUE" v={event.location ?? "TBA"} />
          </div>

          <a href="#cmp-tickets" className="cmp-hero-cta">
            GET YOUR SPOT <span className="cmp-cta-arrow">&rarr;</span>
          </a>
        </div>
      </section>

      {/* ── VISION ─────────────────────────────────────────── */}
      <section className="cmp-vision">
        <p className="cmp-section-tab">THE VISION</p>
        <blockquote className="cmp-vision-quote">
          Activating the everyday Christian in South Africa to see the{" "}
          <span className="cmp-hl">Great Commission fulfilled.</span>
        </blockquote>
        <p className="cmp-vision-cite">
          {STAR} a generation of young people, sent out and switched on — no cap.
          this is where it starts. &#128293;
        </p>
      </section>

      {/* ── TICKETS ────────────────────────────────────────── */}
      <section className="cmp-tickets" id="cmp-tickets">
        <div className="cmp-tickets-head">
          <h2 className="cmp-h2">GRAB A PASS</h2>
          <p className="cmp-section-tab cmp-section-tab-cream">
            SECURE YOUR PLACE &#129310;
          </p>
        </div>

        {visibleTickets.length === 0 ? (
          <div className="cmp-empty">
            <p>NO PASSES ON SALE YET.</p>
            <span>{STAR} check back soon — the drop is coming &#128064;</span>
          </div>
        ) : (
          <div className="cmp-ticket-grid">
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
        <section className="cmp-extras">
          <div className="cmp-field">
            <label className="cmp-label" htmlFor="cmp-promo">
              [ PROMO / COMP CODE ]
            </label>
            {appliedPromo ? (
              <div className="cmp-promo-applied">
                <div className="cmp-promo-applied-info">
                  <span className="cmp-promo-applied-code">
                    {appliedPromo.code} APPLIED {STAR}
                  </span>
                  <span className="cmp-promo-applied-amount">
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
                  className="cmp-promo-remove"
                  aria-label="Remove promo code"
                >
                  REMOVE ×
                </button>
              </div>
            ) : (
              <div className="cmp-promo-row">
                <input
                  id="cmp-promo"
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
                  className="cmp-input cmp-input-mono"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={checkingPromo || !promoCode.trim()}
                  className="cmp-promo-apply"
                >
                  {checkingPromo ? "…" : "APPLY"}
                </button>
              </div>
            )}
            {promoError && <p className="cmp-promo-error">{promoError}</p>}
          </div>
          <div className="cmp-field">
            <label className="cmp-label" htmlFor="cmp-gift">
              {`[ ADD A GIFT — ${currency} ]`}
            </label>
            <div className="cmp-money-wrap">
              <span className="cmp-money-prefix">R</span>
              <input
                id="cmp-gift"
                type="number"
                step="0.01"
                min="0"
                value={donationRands}
                onChange={(e) => setDonationRands(e.target.value)}
                placeholder="0.00"
                className="cmp-input cmp-input-money"
              />
            </div>
          </div>
        </section>
      )}

      {/* ── BUYER ──────────────────────────────────────────── */}
      {lineCount > 0 && (
        <section className="cmp-buyer" id="cmp-buyer">
          <div className="cmp-tickets-head">
            <h2 className="cmp-h2 cmp-h2-blue">YOUR DETAILS</h2>
            <p className="cmp-section-tab">WHO&apos;S COMING</p>
          </div>
          {(bf.first_name.enabled || bf.last_name.enabled) && (
            <div className="cmp-buyer-grid">
              {bf.first_name.enabled && (
                <div className="cmp-field">
                  <label className="cmp-label" htmlFor="cmp-fn">
                    [ FIRST NAME{bf.first_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="cmp-fn"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="cmp-input"
                  />
                </div>
              )}
              {bf.last_name.enabled && (
                <div className="cmp-field">
                  <label className="cmp-label" htmlFor="cmp-ln">
                    [ LAST NAME{bf.last_name.required ? " *" : ""} ]
                  </label>
                  <input
                    id="cmp-ln"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="cmp-input"
                  />
                </div>
              )}
            </div>
          )}
          <div className="cmp-field">
            <label className="cmp-label" htmlFor="cmp-em">
              [ EMAIL * ]
            </label>
            <input
              id="cmp-em"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="cmp-input cmp-input-mono"
            />
          </div>
          {bf.phone.enabled && (
            <div className="cmp-field">
              <label className="cmp-label" htmlFor="cmp-ph">
                [ PHONE{bf.phone.required ? " *" : " — OPTIONAL"} ]
              </label>
              <PhoneInputNative
                id="cmp-ph"
                value={phone}
                onChange={setPhone}
                selectClassName="cmp-input"
                inputClassName="cmp-input cmp-input-mono"
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
              classes={CAMPS_CHECKOUT_CLASSES}
            />
          )}
          {waiverSlots.length > 0 && (
            <WaiverSignatureSection
              eventId={event.id}
              slots={waiverSlots}
              valuesBySlot={waiverValues}
              errorsBySlot={waiverErrors}
              variant="light"
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
              classes={CAMPS_CHECKOUT_CLASSES}
              titleClassName="cmp-label"
            />
          )}
          {bf.marketing_consent.enabled && (
            <label className="cmp-consent">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
              />
              <span>
                KEEP ME IN THE LOOP — SEND ME FFSA CAMPS &amp; EVENTS BY EMAIL.
              </span>
            </label>
          )}
          <div className={`cmp-consent-box${consentAccepted ? " is-accepted" : ""}`}>
            <div className="cmp-consent-head">
              <span className="cmp-consent-title">Required before you can pay</span>
              <span className="cmp-consent-badge">
                {consentAccepted ? "✓ Accepted" : "Required"}
              </span>
            </div>
            <label className="cmp-consent">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                required
              />
              <span>
                <span className="cmp-consent-star">* </span>
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
              <p className="cmp-consent-warn">
                ⚠ Please tick this box to enable the payment button below.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── PAY (inline, desktop + fallback) ───────────────── */}
      {lineCount > 0 && (
        <section className="cmp-pay">
          {(promoDiscountCents > 0 || donationCents > 0) && (
            <div className="cmp-pay-breakdown">
              <div className="cmp-pay-row">
                <span>SUBTOTAL</span>
                <span className="cmp-pay-row-v">{money(subtotalCents)}</span>
              </div>
              {promoDiscountCents > 0 && (
                <div className="cmp-pay-row cmp-pay-row-discount">
                  <span>DISCOUNT ({appliedPromo?.code})</span>
                  <span className="cmp-pay-row-v">−{money(promoDiscountCents)}</span>
                </div>
              )}
              {donationCents > 0 && (
                <div className="cmp-pay-row">
                  <span>GIFT</span>
                  <span className="cmp-pay-row-v">+{money(donationCents)}</span>
                </div>
              )}
            </div>
          )}
          <div className="cmp-pay-total">
            <span className="cmp-pay-total-k">TOTAL DUE</span>
            <span className="cmp-pay-total-v">{money(totalCents)}</span>
          </div>
          <p className="cmp-pay-note">
            {isFreeOrder ? (
              <>{STAR} your code covers this in full — nothing to pay.{" "}</>
            ) : (
              <>
                {STAR} secure checkout via {canUsePayfast ? "PayFast" : "Stripe"}.{" "}
              </>
            )}
            {lineCount} pass
            {lineCount === 1 ? "" : "es"} held for you &#128153;
          </p>
          {err && <p className="cmp-error">{STAR} {err}</p>}
          {!err && !buyerValid && (
            <p className="cmp-error">
              Enter your details above — a valid email address is needed before
              the payment button turns on.
            </p>
          )}
          {isFreeOrder ? (
            <button
              type="button"
              onClick={() => submit(canUsePayfast ? "payfast" : "stripe")}
              disabled={submitting !== null || !buyerValid || !consentAccepted}
              className="cmp-paybtn"
            >
              {submitting !== null ? "LOCKING IT IN…" : "GET MY PASSES"}
              {submitting === null && (
                <span className="cmp-cta-arrow">&rarr;</span>
              )}
            </button>
          ) : (
            <>
            {canUsePayfast && (
              <button
                type="button"
                onClick={() => submit("payfast")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                className="cmp-paybtn"
              >
                {submitting === "payfast" ? "LOCKING IT IN…" : `PAY ${money(totalCents)}`}
                {submitting !== "payfast" && <span className="cmp-cta-arrow">&rarr;</span>}
              </button>
            )}
            {/* Stripe is the alternative on a ZAR event and the only
                option on any other currency, so it takes the primary
                button styling when PayFast can't be offered. */}
            <div className={canUsePayfast ? "cmp-paybtn-alt-wrap" : undefined}>
              <button
                type="button"
                onClick={() => submit("stripe")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                className={canUsePayfast ? "cmp-paybtn-alt" : "cmp-paybtn"}
              >
                {submitting === "stripe"
                  ? "LOCKING IT IN…"
                  : canUsePayfast
                    ? "PAY WITH INTERNATIONAL CARD"
                    : `PAY ${money(totalCents)}`}
                {submitting !== "stripe" && (
                  <span className="cmp-cta-arrow">&rarr;</span>
                )}
              </button>
              {canUsePayfast && (
                <p className="cmp-paybtn-alt-note">
                  {STAR} card declined on PayFast? amex / apple&nbsp;pay / google&nbsp;pay?
                  use Stripe.
                </p>
              )}
            </div>

            </>
          )}
        </section>
      )}

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="cmp-footer">
        <span className="cmp-footer-word">FFSA CAMPS</span>
        <p className="cmp-footer-vision">
          Activating the everyday Christian in South Africa to see the Great
          Commission fulfilled.
        </p>
        <p className="cmp-footer-meta">
          {event.title.toUpperCase()} &middot; POWERED BY FFSA HUB &middot; &copy;{" "}
          MMXXVI
        </p>
      </footer>

      {/* ── STICKY MOBILE CTA ──────────────────────────────── */}
      {lineCount > 0 && (
        <div className="cmp-sticky">
          <div className="cmp-sticky-info">
            <span className="cmp-sticky-k">
              {lineCount} PASS{lineCount === 1 ? "" : "ES"}
            </span>
            <span className="cmp-sticky-v">{money(totalCents)}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              submit(canUsePayfast ? "payfast" : "stripe")
            }
            disabled={submitting !== null}
            className="cmp-sticky-btn"
          >
            {submitting !== null ? "…" : "CHECKOUT"}
            <span className="cmp-cta-arrow">&rarr;</span>
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
    <div className="cmp-coord">
      <span className="cmp-coord-k">{k}</span>
      <span className="cmp-coord-v">{v}</span>
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
  // Alternate stub colour per tier so a list of passes reads like a strip of
  // differently-stamped tickets while staying in the blue/cream family.
  const accents = ["blue", "ink"] as const;
  const accent = accents[idx % accents.length];
  const serial = String(idx + 1).padStart(3, "0");

  return (
    <article
      className={`cmp-pass cmp-pass-${accent} ${!onSale ? "cmp-pass-off" : ""} ${
        qty > 0 ? "cmp-pass-active" : ""
      }`}
    >
      <div className="cmp-pass-stub" aria-hidden>
        <span>ADMIT</span>
        <span>ONE</span>
        <span className="cmp-pass-serial">{serial}</span>
      </div>

      <div className="cmp-pass-body">
        <div className="cmp-pass-top">
          <h3 className="cmp-pass-name">{t.name}</h3>
          <div className="cmp-pass-flags">
            {isPwyw && <span className="cmp-flag cmp-flag-blue">PAY WHAT YOU WANT</span>}
            {!onSale && (
              <span className="cmp-flag cmp-flag-ink">
                {soldOut ? "SOLD OUT" : "NOT ON SALE"}
              </span>
            )}
            {onSale && rem != null && rem > 0 && rem <= 10 && (
              <span className="cmp-flag cmp-flag-ink">ONLY {rem} LEFT</span>
            )}
          </div>
        </div>

        {t.description && <p className="cmp-pass-desc">{t.description}</p>}

        <p className="cmp-pass-fine">
          {STAR} ADMIT ONE · {(venue ?? "TBA").toUpperCase()} · {dateRange}
        </p>

        <div className="cmp-pass-foot">
          <div className="cmp-pass-price">
            {isPwyw && <span className="cmp-pass-price-pre">FROM</span>}
            <span className="cmp-pass-price-v">{money(t.display_price_cents)}</span>
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
              <button type="button" className="cmp-add" onClick={() => onQty(1)}>
                ADD <span className="cmp-cta-arrow">&rarr;</span>
              </button>
            ) : (
              <button
                type="button"
                className="cmp-add cmp-add-remove"
                onClick={() => onQty(0)}
              >
                REMOVE
              </button>
            ))}
        </div>

        {isPwyw && qty > 0 && (
          <div className="cmp-pwyw">
            <label className="cmp-label" htmlFor={`pwyw-${t.id}`}>
              {`[ YOUR AMOUNT — ${currency} ]`}
            </label>
            <div className="cmp-money-wrap">
              <span className="cmp-money-prefix">R</span>
              <input
                id={`pwyw-${t.id}`}
                type="number"
                step="0.01"
                min={t.display_price_cents / 100}
                defaultValue={((pwywAmount ?? t.display_price_cents) / 100).toFixed(2)}
                onChange={(e) => onPwyw(e.target.value)}
                className="cmp-input cmp-input-money"
              />
            </div>
          </div>
        )}
      </div>

      {soldOut && (
        <div className="cmp-soldout-band" aria-hidden>
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
    <div className="cmp-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
        aria-label="Remove one"
      >
        &minus;
      </button>
      <span className="cmp-stepper-n">{String(qty).padStart(2, "0")}</span>
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
// Scoped styles — all under `.cmp` so the app's global rules and
// dark theme don't leak in. Cream base, bright-blue frame + accents,
// dot-grid texture, heavy italic display. Light color-scheme.
// ──────────────────────────────────────────────────────────────

const scopedCss = `
.cmp{
  --blue:#2F65E8; --cream:#F2E8CC; --white:#FFFFFF;
  --ink:#14224A; --sky:#E4ECFD;
  --display:'Aileron','Helvetica Neue',Arial,sans-serif;
  --body:'Helvetica Neue',Helvetica,Arial,sans-serif;
  font-family:var(--body);
  background:var(--cream);
  color:var(--ink);
  color-scheme:light;
  -webkit-font-smoothing:antialiased;
  letter-spacing:0;
}
.cmp *{box-sizing:border-box;}
.cmp ::selection{background:var(--blue);color:var(--cream);}

/* Display helper — heavy italic is the FFSA Camps signature. */
.cmp-disp{font-family:var(--display);font-style:italic;font-weight:900;}

/* Reset the app's aggressive global input styling inside our scope.
   Globals use input:not([checkbox]):not([radio]):not([range]) = (0,3,1)
   with !important, so we mirror the :not() chain to out-specify it. */
.cmp input:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  background:var(--white) !important;
  color:var(--ink) !important;
  border:2px solid var(--blue) !important;
  border-radius:0 !important;
  font-family:var(--body) !important;
  font-size:15px !important;
  padding:13px 14px !important;
  width:100% !important;
  text-transform:none !important;
  letter-spacing:.02em !important;
  box-shadow:none !important;
}
.cmp input:not([type="checkbox"]):not([type="radio"]):not([type="range"])::placeholder{
  color:rgba(20,34,74,.42) !important;
}
.cmp input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus{
  outline:none !important;
  border-color:var(--blue) !important;
  box-shadow:4px 4px 0 var(--blue) !important;
}
.cmp input.cmp-input-money:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  padding-left:30px !important;
}
.cmp input[type="checkbox"]{
  width:20px !important;height:20px !important;flex:0 0 20px;
  accent-color:var(--blue) !important;padding:0 !important;
  border:2px solid var(--blue) !important;border-radius:0 !important;
  background:var(--white) !important;
}
/* Checkout-question controls — globals don't reach select/textarea, and
   the input reset above is input-only, so theme them to match. */
.cmp select, .cmp textarea{
  width:100%;padding:13px 14px;border-radius:0;
  border:2px solid var(--blue);background:var(--white);color:var(--ink);
  font-family:var(--body);font-size:15px;
  -webkit-appearance:none;-moz-appearance:none;appearance:none;
}
.cmp select:focus, .cmp textarea:focus{
  outline:none;border-color:var(--blue);box-shadow:4px 4px 0 var(--blue);
}
.cmp-opt-row{
  display:flex;gap:10px;align-items:center;cursor:pointer;
  font-size:13px;letter-spacing:.02em;color:var(--ink);
}
.cmp-checkout-help{
  font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--ink);opacity:.65;
}

/* ── TICKER ── */
.cmp-ticker{
  background:var(--blue);border-bottom:2px solid var(--cream);
  overflow:hidden;white-space:nowrap;padding:8px 0;position:relative;
}
.cmp-ticker-track{display:inline-flex;animation:cmp-marq 38s linear infinite;}
.cmp-ticker-group{display:inline-flex;}
.cmp-ticker-item{
  font-family:var(--display);font-style:italic;font-weight:900;font-size:14px;
  letter-spacing:.16em;color:var(--cream);padding:0 .35em;
  display:inline-flex;align-items:center;text-transform:uppercase;
}
.cmp-ticker-star{color:var(--cream);opacity:.7;padding:0 .55em;font-size:12px;}
@keyframes cmp-marq{from{transform:translateX(0);}to{transform:translateX(-50%);}}

/* ── MASTHEAD ── */
.cmp-masthead{
  background:var(--white);color:var(--ink);
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 18px;border-bottom:2px solid var(--blue);
}
.cmp-logo-word{
  font-family:var(--display);font-style:italic;font-weight:900;
  font-size:23px;letter-spacing:-.01em;white-space:nowrap;
  color:var(--blue);line-height:1;text-transform:uppercase;
}
.cmp-logo-img{height:30px;width:auto;object-fit:contain;}
.cmp-masthead-meta{
  display:none;gap:8px;align-items:center;font-size:11px;font-weight:700;
  letter-spacing:.18em;color:var(--blue);
}
@media(min-width:480px){.cmp-masthead-meta{display:flex;}}
.cmp-masthead-div{opacity:.5;}

/* ── HERO ── */
.cmp-hero{
  background:var(--cream);
  background-image:radial-gradient(var(--sky) 1.6px, transparent 1.6px);
  background-size:22px 22px;
  padding:40px 18px 48px;
}
.cmp-hero-frame{
  max-width:780px;margin:0 auto;
  background:var(--white);
  border:3px solid var(--blue);
  padding:36px 26px 34px;
  position:relative;
}
.cmp-eyebrow{
  display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;
  font-size:11px;font-weight:700;letter-spacing:.2em;margin:0 0 20px;color:var(--blue);
}
.cmp-tag{
  background:var(--blue);color:var(--cream);padding:3px 9px;font-weight:900;
  letter-spacing:.12em;font-family:var(--display);font-style:italic;
}
.cmp-hero-title{
  font-family:var(--display);font-style:italic;font-weight:900;
  margin:0;line-height:.9;text-transform:uppercase;color:var(--blue);
  font-size:clamp(44px,12vw,104px);letter-spacing:-.01em;word-break:break-word;
}
.cmp-slogan{
  font-family:var(--display);font-style:italic;font-weight:900;color:var(--cream);
  background:var(--blue);display:inline-flex;align-items:center;gap:.4em;
  font-size:clamp(15px,4.4vw,22px);letter-spacing:.1em;
  padding:7px 14px;margin:20px 0 0;text-transform:uppercase;
}
.cmp-hero-desc{
  margin:20px 0 0;font-size:14px;line-height:1.7;color:var(--ink);
  max-width:560px;opacity:.86;
}
.cmp-coords{
  margin-top:26px;display:grid;gap:2px;background:var(--blue);
  border:2px solid var(--blue);
}
.cmp-coord{
  background:var(--white);padding:11px 13px;display:flex;flex-direction:column;gap:3px;
}
.cmp-coord-k{font-size:10px;font-weight:700;letter-spacing:.18em;color:var(--blue);}
.cmp-coord-v{font-size:13px;color:var(--ink);letter-spacing:.02em;}
.cmp-hero-cta{
  margin-top:28px;display:inline-flex;align-items:center;gap:11px;
  background:var(--blue);color:var(--cream);text-decoration:none;
  font-family:var(--display);font-style:italic;font-weight:900;
  font-size:20px;letter-spacing:.08em;text-transform:uppercase;
  padding:14px 24px;border:2px solid var(--blue);
  box-shadow:6px 6px 0 var(--ink);transition:transform .12s,box-shadow .12s;
}
.cmp-hero-cta:hover{transform:translate(-2px,-2px);box-shadow:9px 9px 0 var(--ink);}
.cmp-cta-arrow{display:inline-block;transition:transform .15s;}
.cmp-hero-cta:hover .cmp-cta-arrow{transform:translateX(5px);}

/* ── VISION ── */
.cmp-vision{
  background:var(--white);color:var(--ink);padding:52px 22px;
  max-width:820px;margin:0 auto;border-bottom:3px solid var(--blue);
}
.cmp-section-tab{font-size:11px;font-weight:700;letter-spacing:.22em;color:var(--blue);margin:0 0 16px;}
.cmp-section-tab-cream{color:var(--cream);opacity:.9;}
.cmp-vision-quote{
  font-family:var(--display);font-style:italic;font-weight:900;text-transform:uppercase;
  font-size:clamp(26px,6.5vw,48px);line-height:1;margin:0;letter-spacing:0;color:var(--ink);
}
.cmp-hl{color:var(--blue);}
.cmp-vision-cite{
  margin:24px 0 0;font-size:13px;line-height:1.7;letter-spacing:.02em;
  color:var(--ink);opacity:.8;max-width:560px;
}

/* ── TICKETS ── */
.cmp-tickets{background:var(--blue);padding:48px 18px 56px;}
.cmp-tickets-head{margin-bottom:26px;}
.cmp-h2{
  font-family:var(--display);font-style:italic;font-weight:900;text-transform:uppercase;
  font-size:clamp(40px,12vw,80px);line-height:.9;margin:0;color:var(--cream);letter-spacing:-.005em;
}
.cmp-h2-blue{color:var(--blue);}
.cmp-ticket-grid{display:grid;gap:18px;max-width:780px;margin:0 auto;}
@media(min-width:760px){.cmp-ticket-grid{grid-template-columns:1fr 1fr;}}

.cmp-pass{
  position:relative;display:flex;background:var(--white);
  border:3px solid var(--ink);overflow:hidden;
  transition:transform .14s ease,box-shadow .14s ease;
}
.cmp-pass:hover{transform:translateY(-3px) rotate(-.3deg);box-shadow:0 14px 0 -4px rgba(20,34,74,.22);}
.cmp-pass-active{box-shadow:7px 7px 0 var(--cream);}
.cmp-pass-off{opacity:.6;}
.cmp-pass-stub{
  flex:0 0 40px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;border-right:3px dashed var(--ink);
  font-family:var(--display);font-style:italic;font-weight:900;letter-spacing:.12em;font-size:13px;
  writing-mode:vertical-rl;transform:rotate(180deg);padding:14px 0;
}
.cmp-pass-serial{font-size:10px;opacity:.6;letter-spacing:.08em;}
.cmp-pass-blue .cmp-pass-stub{background:var(--blue);color:var(--cream);}
.cmp-pass-ink .cmp-pass-stub{background:var(--ink);color:var(--cream);}
.cmp-pass-body{flex:1;padding:18px 18px 20px;min-width:0;}
.cmp-pass-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.cmp-pass-name{
  font-family:var(--display);font-style:italic;font-weight:900;text-transform:uppercase;
  font-size:clamp(22px,6vw,32px);line-height:.92;margin:0;color:var(--ink);word-break:break-word;
}
.cmp-pass-flags{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;}
.cmp-flag{
  font-family:var(--display);font-style:italic;font-weight:900;font-size:11px;letter-spacing:.08em;
  padding:3px 7px;white-space:nowrap;text-transform:uppercase;
}
.cmp-flag-blue{background:var(--blue);color:var(--cream);}
.cmp-flag-ink{background:var(--ink);color:var(--cream);}
.cmp-pass-desc{font-size:12px;line-height:1.6;margin:11px 0 0;color:var(--ink);opacity:.82;}
.cmp-pass-fine{
  font-size:9.5px;font-weight:700;letter-spacing:.06em;margin:12px 0 0;color:var(--ink);
  opacity:.55;border-top:1px dashed rgba(20,34,74,.4);padding-top:9px;text-transform:uppercase;
}
.cmp-pass-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;}
.cmp-pass-price{display:flex;flex-direction:column;line-height:1;}
.cmp-pass-price-pre{font-size:9px;font-weight:700;letter-spacing:.2em;color:var(--blue);margin-bottom:3px;}
.cmp-pass-price-v{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(26px,7vw,36px);color:var(--ink);}

.cmp-stepper{display:flex;align-items:center;border:2.5px solid var(--ink);flex-shrink:0;background:var(--white);}
.cmp-stepper button{
  width:42px;height:42px;font-size:22px;line-height:1;background:var(--blue);color:var(--cream);
  border:none;cursor:pointer;transition:background .12s;font-family:var(--body);
}
.cmp-stepper button:hover:not(:disabled){background:var(--ink);}
.cmp-stepper button:disabled{opacity:.3;cursor:not-allowed;}
.cmp-stepper-n{width:44px;text-align:center;font-weight:700;font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums;}

.cmp-add{
  font-family:var(--display);font-style:italic;font-weight:900;font-size:17px;letter-spacing:.06em;
  background:var(--blue);color:var(--cream);border:2.5px solid var(--ink);
  padding:9px 17px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  transition:transform .12s;flex-shrink:0;text-transform:uppercase;
}
.cmp-add:hover{transform:translateY(-2px);}
.cmp-add-remove{background:transparent;color:var(--ink);}
.cmp-pwyw{margin-top:14px;}

.cmp-soldout-band{
  position:absolute;top:22px;right:-46px;transform:rotate(38deg);
  background:var(--ink);color:var(--cream);font-family:var(--display);font-style:italic;font-weight:900;
  letter-spacing:.14em;font-size:15px;padding:5px 56px;
}
.cmp-empty{
  text-align:center;color:var(--cream);max-width:520px;margin:0 auto;
  border:2px dashed rgba(242,232,204,.5);padding:40px 24px;
}
.cmp-empty p{font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;margin:0 0 8px;color:var(--cream);text-transform:uppercase;}
.cmp-empty span{font-size:12px;letter-spacing:.06em;opacity:.85;}

/* ── EXTRAS / BUYER / PAY ── */
.cmp-extras,.cmp-buyer,.cmp-pay{
  background:var(--cream);max-width:780px;margin:0 auto;padding:34px 20px;
}
.cmp-extras{display:grid;gap:18px;border-bottom:3px solid var(--blue);}
@media(min-width:620px){.cmp-extras{grid-template-columns:1fr 1fr;}}
.cmp-buyer{border-bottom:3px solid var(--blue);}
.cmp-buyer-grid{display:grid;gap:16px;}
@media(min-width:520px){.cmp-buyer-grid{grid-template-columns:1fr 1fr;}}
.cmp-field{margin-bottom:16px;}
.cmp-buyer-grid .cmp-field{margin-bottom:0;}
.cmp-label{
  display:block;font-size:11px;letter-spacing:.16em;font-weight:700;
  color:var(--ink);margin-bottom:7px;
}
.cmp-input-mono{letter-spacing:.04em;}
.cmp-money-wrap{position:relative;display:flex;align-items:center;}
.cmp-money-prefix{
  position:absolute;left:13px;font-weight:900;color:var(--blue);font-size:15px;pointer-events:none;z-index:1;
}
.cmp-consent{
  display:flex;gap:11px;align-items:flex-start;margin-top:20px;cursor:pointer;
  font-size:11px;line-height:1.6;letter-spacing:.04em;color:var(--ink);font-weight:700;
}
.cmp-consent-box{margin-top:20px;border:2px solid var(--blue);border-radius:10px;padding:16px;background:rgba(0,0,0,0.02);}
.cmp-consent-box.is-accepted{border-color:rgba(0,0,0,0.15);}
.cmp-consent-box .cmp-consent{margin-top:0;}
.cmp-consent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}
.cmp-consent-title{font-family:var(--display);font-style:italic;font-weight:900;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);}
.cmp-consent-badge{font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:var(--blue);color:var(--cream);}
.cmp-consent-box.is-accepted .cmp-consent-badge{background:rgba(0,0,0,0.08);color:var(--ink);}
.cmp-consent-star{color:#d64545;font-weight:900;}
.cmp-consent-warn{margin:8px 0 0 27px;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--blue);}

/* ── Promo apply / applied chip ── */
.cmp-promo-row{display:flex;gap:8px;align-items:stretch;}
.cmp-promo-row .cmp-input{flex:1;min-width:0;}
.cmp-promo-apply{
  font-family:var(--display);font-style:italic;font-weight:900;font-size:15px;letter-spacing:.08em;
  background:var(--blue);color:var(--cream);border:2px solid var(--blue);
  padding:0 16px;cursor:pointer;flex-shrink:0;transition:background .12s;text-transform:uppercase;
}
.cmp-promo-apply:hover:not(:disabled){background:var(--ink);border-color:var(--ink);}
.cmp-promo-apply:disabled{opacity:.4;cursor:not-allowed;}
.cmp-promo-applied{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  border:2px solid var(--blue);background:var(--blue);color:var(--cream);padding:10px 12px;
}
.cmp-promo-applied-info{display:flex;flex-direction:column;gap:2px;min-width:0;}
.cmp-promo-applied-code{font-family:var(--display);font-style:italic;font-weight:900;font-size:16px;letter-spacing:.03em;text-transform:uppercase;}
.cmp-promo-applied-amount{font-size:11px;letter-spacing:.04em;opacity:.9;}
.cmp-promo-remove{
  font-family:var(--display);font-style:italic;font-weight:900;font-size:12px;letter-spacing:.08em;
  background:transparent;color:var(--cream);border:1.5px solid var(--cream);padding:5px 9px;cursor:pointer;flex-shrink:0;
}
.cmp-promo-error{font-size:11px;letter-spacing:.04em;margin:6px 0 0;color:var(--ink);font-weight:700;}

/* ── PAY ── */
.cmp-pay{text-align:left;}
.cmp-pay-breakdown{border-top:3px solid var(--blue);padding:14px 0 10px;display:flex;flex-direction:column;gap:5px;}
.cmp-pay-row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--ink);}
.cmp-pay-row-v{font-variant-numeric:tabular-nums;}
.cmp-pay-row-discount{color:var(--blue);}
.cmp-pay-total{
  display:flex;align-items:baseline;justify-content:space-between;
  border-top:3px solid var(--blue);border-bottom:3px solid var(--blue);padding:16px 0;margin-bottom:14px;
}
.cmp-pay-total-k{font-family:var(--display);font-style:italic;font-weight:900;font-size:20px;letter-spacing:.1em;color:var(--ink);text-transform:uppercase;}
.cmp-pay-total-v{font-family:var(--display);font-style:italic;font-weight:900;font-size:40px;color:var(--blue);line-height:1;}
.cmp-pay-note{font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--ink);opacity:.7;margin:0 0 14px;}
.cmp-error{background:var(--ink);color:var(--cream);padding:10px 13px;font-size:12px;font-weight:700;letter-spacing:.04em;margin:0 0 14px;}
.cmp-paybtn{
  width:100%;background:var(--blue);color:var(--cream);border:3px solid var(--ink);
  font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;letter-spacing:.03em;
  padding:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;
  box-shadow:7px 7px 0 var(--ink);transition:transform .12s,box-shadow .12s;text-transform:uppercase;
}
.cmp-paybtn:hover:not(:disabled){transform:translate(-2px,-2px);box-shadow:10px 10px 0 var(--ink);}
.cmp-paybtn:active:not(:disabled){transform:translate(2px,2px);box-shadow:3px 3px 0 var(--ink);}
.cmp-paybtn:disabled{opacity:.45;cursor:not-allowed;box-shadow:4px 4px 0 var(--ink);}

.cmp-paybtn-alt-wrap{margin-top:14px;}
.cmp-paybtn-alt{
  width:100%;background:transparent;color:var(--ink);border:2.5px solid var(--ink);
  font-family:var(--display);font-style:italic;font-weight:900;font-size:17px;letter-spacing:.08em;
  padding:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  transition:background .12s,color .12s;text-transform:uppercase;
}
.cmp-paybtn-alt:hover:not(:disabled){background:var(--ink);color:var(--cream);}
.cmp-paybtn-alt:disabled{opacity:.45;cursor:not-allowed;}
.cmp-paybtn-alt-note{text-align:center;font-size:10px;font-weight:700;letter-spacing:.06em;margin:7px 0 0;color:var(--ink);opacity:.7;}

/* ── FOOTER ── */
.cmp-footer{
  background:var(--blue);color:var(--cream);text-align:center;padding:42px 20px 120px;
}
.cmp-footer-word{
  font-family:var(--display);font-style:italic;font-weight:900;
  font-size:30px;letter-spacing:-.01em;color:var(--cream);text-transform:uppercase;
}
.cmp-footer-vision{font-size:12px;font-style:italic;line-height:1.6;margin:14px auto 0;opacity:.92;max-width:420px;}
.cmp-footer-meta{font-size:10px;font-weight:700;letter-spacing:.16em;margin:14px 0 0;opacity:.8;}

/* ── STICKY MOBILE CTA ── */
.cmp-sticky{
  position:fixed;left:0;right:0;bottom:0;z-index:60;
  background:var(--ink);border-top:3px solid var(--blue);
  display:flex;align-items:stretch;gap:0;padding:0;box-shadow:0 -8px 24px rgba(20,34,74,.3);
}
.cmp-sticky-info{flex:1;display:flex;flex-direction:column;justify-content:center;padding:11px 16px;}
.cmp-sticky-k{font-size:10px;font-weight:700;letter-spacing:.16em;color:var(--cream);opacity:.8;}
.cmp-sticky-v{font-family:var(--display);font-style:italic;font-weight:900;font-size:24px;color:var(--cream);line-height:1;}
.cmp-sticky-btn{
  background:var(--blue);color:var(--cream);border:none;
  font-family:var(--display);font-style:italic;font-weight:900;font-size:22px;letter-spacing:.06em;
  padding:0 24px;cursor:pointer;display:flex;align-items:center;gap:9px;text-transform:uppercase;
}
.cmp-sticky-btn:disabled{opacity:.6;}
@media(min-width:760px){
  .cmp-sticky{display:none;}
  .cmp-footer{padding-bottom:48px;}
}

@media(prefers-reduced-motion:reduce){
  .cmp-ticker-track{animation:none;}
}
`;
