"use client";

import { useMemo, useState } from "react";
import { EventDescription } from "@/components/events/event-description";
import type { CSSProperties } from "react";
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
  FFSA_BRAND,
  FFSA_COLORS,
  FFSA_LOGOS,
} from "@/lib/brand/ffsa";
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

// ============================================================
// FIRE & FRAGRANCE — bespoke ticketing storefront (brand='ff')
// ============================================================
// The FFSA house-brand event page, designed against the FFSA Brand Deck
// (South Africa : Brand Guidelines). Sibling to the-send / camps /
// preachers storefronts; like them it owns the full viewport and injects
// its own scoped CSS, and it forks the generic storefront's checkout
// logic verbatim so payment behaviour (PWYW, promo, gift, currency,
// PayFast/Stripe routing, custom questions) stays identical.
//
// Design language, straight from the deck:
//   - true-black canvas, oversized ROBOTO BLACK uppercase headlines
//     (stacked, tight, negative-tracked — the deck's signature)
//   - Space Mono accents: eyebrows, field-labels, coordinates, prices
//   - the deck's information design: bold uppercase label + value
//     (WHEN / WHERE, mirroring SLOGAN / POSITIONING / VISION)
//   - #FFB801 as the single sharp accent; #C5C2AE bone as muted type;
//     #4C9F37 green for confirmed states; #000DE5 blue paired with yellow
//     in the kinetic marquee (the FFX blue+yellow energy expressed as
//     moving type, NOT a pasted graphic)
//   - a footer that reproduces the deck cover's contact row verbatim
// Palette + copy are read from the shared brand module so this page can
// never drift from the emails or the /brand-kit reference.
// ============================================================

const FFX_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "ffx-cq",
  label: "ffx-cq-label",
  required: "ffx-req",
  input: "ffx-input",
  textarea: "ffx-input ffx-textarea",
  select: "ffx-input ffx-select",
  optionRow: "ffx-option",
  optionText: "ffx-option-text",
  help: "ffx-help",
  error: "ffx-err",
};

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

export function FfsaStorefront({
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
  const currency = event.currency;
  const money = (cents: number) => formatMoney(cents, currency);
  const canUsePayfast = providersForCurrency(currency).includes("payfast");
  const now = useMemo(() => new Date(), []);
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

  // Email is always required; other fields only block checkout when the
  // organizer enabled + marked them required (buyer_fields, migration 140).
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
    if (!buyerValid) {
      setErr("Please complete your name and a valid email.");
      return;
    }
    if (!consentAccepted) {
      setErr(
        "Please accept the Ticket Purchase Terms & Consent Agreement to continue."
      );
      return;
    }
    if (checkoutQuestions.length > 0) {
      const v = validateCheckoutAnswers(checkoutQuestions, customAnswers);
      if (!v.valid) {
        setCustomErrors(v.errors);
        setErr("Please complete the required questions below.");
        return;
      }
      setCustomErrors({});
    }
    const ticketCollect = collectTicketAnswers(ticketSlots, ticketAnswers);
    if (!ticketCollect.valid) {
      setTicketErrors(ticketCollect.errors);
      setErr("Please complete the required questions for each ticket below.");
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

  // ── Derived copy ────────────────────────────────────────────
  const dateLong =
    event.end_date && event.end_date !== event.start_date
      ? `${formatDate(event.start_date)} → ${formatDate(event.end_date)}`
      : formatDate(event.start_date);
  const timeRange =
    event.start_time && event.end_time
      ? `${formatTime(event.start_time)} – ${formatTime(event.end_time)}`
      : event.start_time
        ? formatTime(event.start_time)
        : null;

  // Marquee content — the slogan, repeated, blue ✦ between phrases.
  const marqueePhrases = [
    "CATALYZE OUR GENERATION",
    "EVANGELIZE THE WORLD",
    "WE MOVE",
    "TO THE ENDS OF THE EARTH FOR LOVE",
  ];

  // Palette driven straight from the brand module.
  const paletteVars = {
    "--blk": FFSA_COLORS.BLACK,
    "--wht": FFSA_COLORS.WHITE,
    "--bone": FFSA_COLORS.BONE,
    "--ylw": FFSA_COLORS.YELLOW,
    "--grn": FFSA_COLORS.GREEN,
    "--blu": FFSA_COLORS.BLUE,
  } as CSSProperties;

  return (
    <div
      className="ffx"
      style={{
        ...paletteVars,
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        zIndex: 50,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <header className="ffx-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ffx-topbar-mark"
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
        />
        <span className="ffx-topbar-tag">
          {FFSA_BRAND.region} <i className="ffx-dot" /> Tickets
        </span>
      </header>

      {/* ── KINETIC MARQUEE (the FFX energy as moving type) ──── */}
      <div className="ffx-marquee" aria-hidden>
        <div className="ffx-marquee-track">
          {[0, 1].map((dup) => (
            <div className="ffx-marquee-group" key={dup}>
              {marqueePhrases.map((p, i) => (
                <span className="ffx-marquee-item" key={`${dup}-${i}`}>
                  {p}
                  <span className="ffx-marquee-sep">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <main className="ffx-wrap">
        {/* ── HERO ──────────────────────────────────────────── */}
        <section className="ffx-hero ffx-reveal" style={{ animationDelay: "40ms" }}>
          {event.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="ffx-hero-logo" src={event.logo_url} alt="" />
          )}
          <p className="ffx-eyebrow">
            <i className="ffx-dot ffx-dot-y" /> Get your ticket
          </p>
          <h1 className="ffx-title">{event.title}</h1>
          <div className="ffx-rule" />

          <dl className="ffx-coords">
            <div className="ffx-coord">
              <dt>When</dt>
              <dd>
                {dateLong}
                {timeRange ? (
                  <>
                    <br />
                    <span className="ffx-coord-sub">{timeRange}</span>
                  </>
                ) : null}
              </dd>
            </div>
            {event.location && (
              <div className="ffx-coord">
                <dt>Where</dt>
                <dd>{event.location}</dd>
              </div>
            )}
          </dl>

          {event.description && (
            <EventDescription html={event.description} className="ffx-desc" />
          )}
        </section>

        {/* ── ATTRIBUTES STRIP (deck: brand attributes) ─────── */}
        <div className="ffx-attrs ffx-reveal" style={{ animationDelay: "120ms" }}>
          {FFSA_BRAND.attributes.slice(0, 8).map((a, i) => (
            <span className="ffx-attr" key={a}>
              {i > 0 && <i className="ffx-attr-sep">/</i>}
              {a}
            </span>
          ))}
        </div>

        {/* ── TICKETS ───────────────────────────────────────── */}
        <section className="ffx-block ffx-reveal" style={{ animationDelay: "180ms" }}>
          <div className="ffx-block-head">
            <p className="ffx-eyebrow">
              <i className="ffx-dot ffx-dot-y" /> Tickets
            </p>
            {visibleTickets.length > 0 && (
              <span className="ffx-block-count">
                {String(visibleTickets.length).padStart(2, "0")}{" "}
                {visibleTickets.length === 1 ? "Tier" : "Tiers"}
              </span>
            )}
          </div>

          {visibleTickets.length === 0 ? (
            <p className="ffx-empty">
              No tickets available right now. Check back soon.
            </p>
          ) : (
            <ul className="ffx-tickets">
              {visibleTickets.map((t, idx) => {
                const onSale = isOnSale(t, now);
                const rem = remaining(t);
                const line = lines[t.id];
                const qty = line?.qty ?? 0;
                const isPwyw = t.pricing_mode === "pwyw";
                const selected = qty > 0;
                return (
                  <li
                    key={t.id}
                    className={`ffx-ticket${selected ? " is-selected" : ""}${
                      !onSale ? " is-off" : ""
                    }`}
                  >
                    <div className="ffx-ticket-main">
                      <span className="ffx-ticket-idx">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="ffx-ticket-info">
                        <div className="ffx-ticket-nameline">
                          <span className="ffx-ticket-name">{t.name}</span>
                          {isPwyw && (
                            <span className="ffx-badge ffx-badge-y">
                              Pay what you want
                            </span>
                          )}
                          {!onSale && (
                            <span className="ffx-badge ffx-badge-off">
                              {rem === 0 ? "Sold out" : "Not on sale"}
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <p className="ffx-ticket-desc">{t.description}</p>
                        )}
                        <p className="ffx-ticket-price">
                          {isPwyw
                            ? `From ${money(t.display_price_cents)}`
                            : money(t.display_price_cents)}
                          {rem != null && rem > 0 && rem <= 10 && (
                            <span className="ffx-ticket-left">
                              Only {rem} left
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ffx-ticket-action">
                        {onSale && !isPwyw && (
                          <QtyStepper
                            qty={qty}
                            onChange={(n) => setQty(t, n)}
                            max={Math.min(t.max_per_order ?? 99, rem ?? 99)}
                          />
                        )}
                        {onSale &&
                          isPwyw &&
                          (qty === 0 ? (
                            <button
                              type="button"
                              className="ffx-add"
                              onClick={() => setQty(t, 1)}
                            >
                              Add
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="ffx-add is-remove"
                              onClick={() => setQty(t, 0)}
                            >
                              Remove
                            </button>
                          ))}
                      </div>
                    </div>
                    {isPwyw && qty > 0 && (
                      <div className="ffx-pwyw">
                        <label className="ffx-cq-label">
                          Your amount ({currency})
                        </label>
                        <input
                          className="ffx-input"
                          type="number"
                          step="0.01"
                          min={t.display_price_cents / 100}
                          defaultValue={(t.display_price_cents / 100).toFixed(2)}
                          onChange={(e) => setPwywAmount(t, e.target.value)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── PROMO + GIFT ──────────────────────────────────── */}
        {visibleTickets.length > 0 && (
          <section className="ffx-block ffx-reveal" style={{ animationDelay: "220ms" }}>
            <div className="ffx-field">
              <label className="ffx-cq-label">Promo or comp code</label>
              {appliedPromo ? (
                <div className="ffx-promo-ok">
                  <div>
                    <p className="ffx-promo-ok-code">{appliedPromo.code} applied</p>
                    <p className="ffx-promo-ok-sub">
                      {promoDiscountCents > 0
                        ? `−${money(promoDiscountCents)} off your order`
                        : appliedPromo.applies_to_ticket_type_id
                          ? "Add the matching tier to use this code."
                          : "No discount on the current cart."}
                    </p>
                  </div>
                  <button type="button" className="ffx-link" onClick={removePromo}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="ffx-promo-row">
                  <input
                    className="ffx-input ffx-mono"
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
                  />
                  <button
                    type="button"
                    className="ffx-btn-ghost"
                    onClick={applyPromo}
                    disabled={checkingPromo || !promoCode.trim()}
                  >
                    {checkingPromo ? "Checking…" : "Apply"}
                  </button>
                </div>
              )}
              {promoError && <p className="ffx-err">{promoError}</p>}
            </div>

            <div className="ffx-field">
              <label className="ffx-cq-label">Add a gift ({currency})</label>
              <input
                className="ffx-input"
                type="number"
                step="0.01"
                min="0"
                value={donationRands}
                onChange={(e) => setDonationRands(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </section>
        )}

        {/* ── SUMMARY ───────────────────────────────────────── */}
        {lineCount > 0 && (
          <section className="ffx-summary ffx-reveal">
            {(promoDiscountCents > 0 || donationCents > 0) && (
              <div className="ffx-summary-lines">
                <div className="ffx-summary-line">
                  <span>Subtotal</span>
                  <span className="ffx-mono">{money(subtotalCents)}</span>
                </div>
                {promoDiscountCents > 0 && (
                  <div className="ffx-summary-line is-discount">
                    <span>Discount · {appliedPromo?.code}</span>
                    <span className="ffx-mono">−{money(promoDiscountCents)}</span>
                  </div>
                )}
                {donationCents > 0 && (
                  <div className="ffx-summary-line">
                    <span>Gift</span>
                    <span className="ffx-mono">+{money(donationCents)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="ffx-total">
              <span className="ffx-total-label">Total</span>
              <span className="ffx-total-value">{money(totalCents)}</span>
            </div>
          </section>
        )}

        {/* ── BUYER DETAILS ─────────────────────────────────── */}
        {lineCount > 0 && (
          <section className="ffx-block ffx-reveal">
            <p className="ffx-eyebrow">
              <i className="ffx-dot ffx-dot-y" /> Your details
            </p>
            {(bf.first_name.enabled || bf.last_name.enabled) && (
              <div className="ffx-grid2">
                {bf.first_name.enabled && (
                  <div className="ffx-field">
                    <label className="ffx-cq-label">
                      First name
                      {bf.first_name.required && (
                        <span className="ffx-req"> *</span>
                      )}
                    </label>
                    <input
                      className="ffx-input"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                )}
                {bf.last_name.enabled && (
                  <div className="ffx-field">
                    <label className="ffx-cq-label">
                      Last name
                      {bf.last_name.required && (
                        <span className="ffx-req"> *</span>
                      )}
                    </label>
                    <input
                      className="ffx-input"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="ffx-field">
              <label className="ffx-cq-label">
                Email<span className="ffx-req"> *</span>
              </label>
              <input
                className="ffx-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {bf.phone.enabled && (
              <div className="ffx-field">
                <label className="ffx-cq-label">
                  Phone
                  {bf.phone.required && <span className="ffx-req"> *</span>}
                </label>
                <input
                  className="ffx-input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            {checkoutQuestions.length > 0 && (
              <div className="ffx-cq-block">
                <CheckoutQuestionFields
                  questions={checkoutQuestions}
                  values={customAnswers}
                  errors={customErrors}
                  onChange={(k, val) =>
                    setCustomAnswers((prev) => ({ ...prev, [k]: val }))
                  }
                  classes={FFX_CHECKOUT_CLASSES}
                />
              </div>
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
              <div className="ffx-cq-block">
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
                  classes={FFX_CHECKOUT_CLASSES}
                  titleClassName="ffx-cq-label"
                />
              </div>
            )}

            {bf.marketing_consent.enabled && (
              <label className="ffx-consent">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                />
                <span>Keep me posted on FFSA events and gatherings by email.</span>
              </label>
            )}
            <div className={`ffx-consent-box${consentAccepted ? " is-accepted" : ""}`}>
              <div className="ffx-consent-head">
                <span className="ffx-consent-title">Required before you can pay</span>
                <span className="ffx-consent-badge">
                  {consentAccepted ? "✓ Accepted" : "Required"}
                </span>
              </div>
              <label className="ffx-consent">
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  required
                />
                <span>
                  <span className="ffx-consent-star">* </span>
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
                <p className="ffx-consent-warn">
                  ⚠ Please tick this box to enable the payment button below.
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── PAY ───────────────────────────────────────────── */}
        {lineCount > 0 && (
          <section className="ffx-pay ffx-reveal">
            {err && <p className="ffx-alert">{err}</p>}
            {canUsePayfast && (
              <button
                type="button"
                className="ffx-cta"
                onClick={() => submit("payfast")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
              >
                <span>
                  {submitting === "payfast"
                    ? "Starting payment…"
                    : `Pay ${money(totalCents)}`}
                </span>
                <span className="ffx-cta-arrow">→</span>
              </button>
            )}
            <button
              type="button"
              className={canUsePayfast ? "ffx-cta-alt" : "ffx-cta"}
              onClick={() => submit("stripe")}
              disabled={submitting !== null || !buyerValid || !consentAccepted}
            >
              <span>
                {submitting === "stripe"
                  ? "Starting payment…"
                  : canUsePayfast
                    ? "Pay with international card"
                    : `Pay ${money(totalCents)}`}
              </span>
              {!canUsePayfast && <span className="ffx-cta-arrow">→</span>}
            </button>
            <p className="ffx-pay-note">
              {canUsePayfast
                ? "Secure checkout via PayFast. Use the international option for cards declined on PayFast or Apple Pay."
                : "You'll be redirected to Stripe to complete payment securely."}
            </p>
          </section>
        )}
      </main>

      {/* ── FOOTER (reproduces the deck cover's contact row) ──── */}
      <footer className="ffx-footer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ffx-footer-mark"
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
        />
        <p className="ffx-footer-slogan">{FFSA_BRAND.slogan.ffsa}</p>
        <p className="ffx-footer-contact">
          <span>{FFSA_BRAND.contact.instagram}</span>
          <i className="ffx-dot" />
          <span>{FFSA_BRAND.contact.website}</span>
          <i className="ffx-dot" />
          <span>{FFSA_BRAND.contact.address}</span>
        </p>
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quantity stepper — bespoke, square, yellow on active
// ────────────────────────────────────────────────────────────
function QtyStepper({
  qty,
  onChange,
  max,
}: {
  qty: number;
  onChange: (n: number) => void;
  max: number;
}) {
  return (
    <div className={`ffx-stepper${qty > 0 ? " is-active" : ""}`}>
      <button
        type="button"
        aria-label="Remove one"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
      >
        −
      </button>
      <span className="ffx-stepper-num">{qty}</span>
      <button
        type="button"
        aria-label="Add one"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":");
  const d = new Date();
  d.setHours(Number.parseInt(h, 10), Number.parseInt(m, 10));
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ────────────────────────────────────────────────────────────
// Scoped CSS — everything lives under `.ffx`
// ────────────────────────────────────────────────────────────
const scopedCss = `
.ffx{
  --disp: var(--font-roboto), 'Roboto', 'Helvetica Neue', Arial, sans-serif;
  --mono: var(--font-space-mono), 'Space Mono', 'Roboto Mono', monospace;
  --line: rgba(255,255,255,0.12);
  --line-soft: rgba(255,255,255,0.07);
  --surf: #0A0A0A;
  --surf-2: #121212;
  --bone-dim: rgba(197,194,174,0.62);
  --bone-faint: rgba(197,194,174,0.34);
  background: var(--blk);
  color: var(--wht);
  font-family: var(--disp);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.ffx *{ box-sizing: border-box; }
/* film grain — the deck's analog warmth */
.ffx::before{
  content:''; position:fixed; inset:0; pointer-events:none; z-index:1;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:200px 200px; opacity:0.045; mix-blend-mode:screen;
}
.ffx > *{ position:relative; z-index:2; }

/* ── Shared type atoms ── */
.ffx-eyebrow{
  margin:0 0 14px; font-family:var(--mono); font-size:11px; font-weight:700;
  letter-spacing:0.24em; text-transform:uppercase; color:var(--ylw);
  display:flex; align-items:center; gap:9px;
}
.ffx-dot{ display:inline-block; width:5px; height:5px; border-radius:50%; background:currentColor; opacity:0.85; }
.ffx-dot-y{ background:var(--ylw); opacity:1; }
.ffx-mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }

/* ── Top bar ── */
.ffx-topbar{
  position:sticky; top:0; z-index:20;
  display:flex; align-items:center; justify-content:space-between;
  gap:16px; padding:16px 22px;
  background:rgba(0,0,0,0.72); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line-soft);
}
.ffx-topbar-mark{ height:17px; width:auto; display:block; }
.ffx-topbar-tag{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.22em;
  text-transform:uppercase; color:var(--bone); display:flex; align-items:center; gap:8px;
}

/* ── Kinetic marquee ── */
.ffx-marquee{
  overflow:hidden; white-space:nowrap; background:var(--ylw);
  border-top:1px solid #000; border-bottom:1px solid #000;
}
.ffx-marquee-track{ display:inline-flex; animation:ffx-marq 32s linear infinite; }
.ffx-marquee-group{ display:inline-flex; }
.ffx-marquee-item{
  font-family:var(--disp); font-weight:900; font-size:14px; letter-spacing:0.04em;
  text-transform:uppercase; color:#000; padding:9px 0; display:inline-flex; align-items:center;
}
.ffx-marquee-sep{ color:var(--blu); margin:0 0.7em; font-size:12px; transform:translateY(-1px); }
@keyframes ffx-marq{ from{transform:translateX(0)} to{transform:translateX(-50%)} }

/* ── Layout ── */
.ffx-wrap{ max-width:760px; margin:0 auto; padding:0 22px 64px; }

/* ── Hero ── */
.ffx-hero{ padding:56px 0 40px; }
.ffx-hero-logo{ height:52px; width:auto; object-fit:contain; margin:0 0 22px; display:block; }
.ffx-title{
  margin:0; font-family:var(--disp); font-weight:900; text-transform:uppercase;
  font-size:clamp(2.7rem, 8.4vw, 5.4rem); line-height:0.9; letter-spacing:-0.025em;
  color:var(--wht); overflow-wrap:break-word; hyphens:none;
}
.ffx-rule{ width:64px; height:6px; background:var(--ylw); margin:26px 0 30px; }
.ffx-coords{ margin:0 0 30px; display:flex; flex-wrap:wrap; gap:34px; }
.ffx-coord dt{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.22em;
  text-transform:uppercase; color:var(--ylw); margin-bottom:7px;
}
.ffx-coord dd{
  margin:0; font-family:var(--disp); font-weight:700; font-size:15px; line-height:1.35;
  color:var(--wht); text-transform:uppercase; letter-spacing:0.01em;
}
.ffx-coord-sub{ font-weight:400; color:var(--bone); text-transform:none; }
.ffx-desc{
  margin:0; max-width:56ch; font-family:var(--disp); font-weight:400; font-size:15.5px;
  line-height:1.75; color:var(--bone); white-space:pre-wrap;
}

/* ── Attributes strip ── */
.ffx-attrs{
  display:flex; flex-wrap:wrap; align-items:center; gap:6px 4px;
  padding:16px 0; border-top:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft);
}
.ffx-attr{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; color:var(--bone-dim); display:inline-flex; align-items:center;
}
.ffx-attr-sep{ color:var(--ylw); font-style:normal; margin:0 10px; opacity:0.7; }

/* ── Section block ── */
.ffx-block{ padding:38px 0 0; }
.ffx-block-head{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:18px; }
.ffx-block-head .ffx-eyebrow{ margin:0; }
.ffx-block-count{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; color:var(--bone-faint); font-variant-numeric:tabular-nums;
}
.ffx-empty{
  font-family:var(--mono); font-size:13px; color:var(--bone-dim);
  border:1px solid var(--line); border-radius:14px; padding:22px; text-align:center;
}

/* ── Tickets ── */
.ffx-tickets{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
.ffx-ticket{
  border:1px solid var(--line); border-radius:16px; background:var(--surf);
  padding:20px; transition:border-color .18s ease, background .18s ease, transform .18s ease;
}
.ffx-ticket:hover{ border-color:rgba(255,255,255,0.24); }
.ffx-ticket.is-selected{
  border-color:var(--ylw); background:rgba(255,184,1,0.06);
}
.ffx-ticket.is-off{ opacity:0.5; }
.ffx-ticket-main{ display:flex; align-items:flex-start; gap:16px; }
.ffx-ticket-idx{
  font-family:var(--mono); font-size:12px; font-weight:700; color:var(--bone-faint);
  padding-top:3px; font-variant-numeric:tabular-nums; min-width:20px;
}
.ffx-ticket.is-selected .ffx-ticket-idx{ color:var(--ylw); }
.ffx-ticket-info{ flex:1; min-width:0; }
.ffx-ticket-nameline{ display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.ffx-ticket-name{
  font-family:var(--disp); font-weight:900; font-size:17px; text-transform:uppercase;
  letter-spacing:-0.01em; color:var(--wht); line-height:1.1;
}
.ffx-ticket-desc{ margin:8px 0 0; font-size:13.5px; line-height:1.6; color:var(--bone); }
.ffx-ticket-price{
  margin:12px 0 0; font-family:var(--mono); font-weight:700; font-size:15px; color:var(--ylw);
  font-variant-numeric:tabular-nums; display:flex; align-items:center; gap:12px; flex-wrap:wrap;
}
.ffx-ticket-left{
  font-family:var(--mono); font-size:9px; font-weight:700; letter-spacing:0.16em;
  text-transform:uppercase; color:var(--blk); background:var(--ylw); padding:2px 7px; border-radius:4px;
}
.ffx-ticket-action{ flex-shrink:0; }
.ffx-badge{
  font-family:var(--mono); font-size:9px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase; padding:3px 8px; border-radius:5px; white-space:nowrap;
}
.ffx-badge-y{ color:var(--ylw); border:1px solid rgba(255,184,1,0.4); }
.ffx-badge-off{ color:var(--bone); border:1px solid var(--line); }

/* ── PWYW input row ── */
.ffx-pwyw{ margin-top:16px; padding-top:16px; border-top:1px solid var(--line-soft); }

/* ── Quantity stepper ── */
.ffx-stepper{ display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.ffx-stepper.is-active{ border-color:var(--ylw); }
.ffx-stepper button{
  width:38px; height:38px; background:transparent; border:0; color:var(--bone);
  font-size:19px; line-height:1; cursor:pointer; transition:background .15s ease, color .15s ease;
}
.ffx-stepper button:hover:not(:disabled){ color:var(--wht); background:rgba(255,255,255,0.06); }
.ffx-stepper button:disabled{ opacity:0.3; cursor:default; }
.ffx-stepper-num{
  width:34px; text-align:center; font-family:var(--mono); font-weight:700; font-size:15px;
  color:var(--wht); font-variant-numeric:tabular-nums;
}
.ffx-stepper.is-active .ffx-stepper-num{ color:var(--ylw); }

/* ── Add / remove (PWYW) ── */
.ffx-add{
  height:38px; padding:0 20px; border-radius:10px; border:1px solid var(--ylw);
  background:var(--ylw); color:#000; font-family:var(--disp); font-weight:900; font-size:12px;
  letter-spacing:0.1em; text-transform:uppercase; cursor:pointer; transition:filter .15s ease;
}
.ffx-add:hover{ filter:brightness(1.08); }
.ffx-add.is-remove{ background:transparent; color:var(--bone); border-color:var(--line); }
.ffx-add.is-remove:hover{ color:var(--wht); border-color:rgba(255,255,255,0.3); }

/* ── Fields / inputs ── */
.ffx-field{ margin-bottom:16px; }
.ffx-field:last-child{ margin-bottom:0; }
.ffx-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.ffx-cq-label, .ffx-cq .ffx-cq-label{
  display:block; font-family:var(--mono); font-size:10px; font-weight:700;
  letter-spacing:0.18em; text-transform:uppercase; color:var(--bone); margin-bottom:8px;
}
.ffx-req{ color:var(--ylw); }
.ffx-input{
  width:100%; padding:12px 14px; background:var(--surf); color:var(--wht);
  border:1px solid var(--line); border-radius:10px; font-family:var(--disp); font-size:15px;
  outline:none; transition:border-color .15s ease, box-shadow .15s ease;
}
.ffx-input::placeholder{ color:var(--bone-faint); }
.ffx-input:focus{ border-color:var(--ylw); box-shadow:0 0 0 3px rgba(255,184,1,0.16); }
.ffx-mono{ font-family:var(--mono); letter-spacing:0.06em; }
.ffx-textarea{ min-height:100px; resize:vertical; }
.ffx-select{ appearance:none; }
.ffx-help{ font-family:var(--disp); font-size:12px; color:var(--bone-faint); margin:7px 0 0; }
.ffx-err{ font-family:var(--mono); font-size:11px; color:#FF6B5A; margin:8px 0 0; letter-spacing:0.02em; }
.ffx-cq{ margin-bottom:16px; }
.ffx-cq-block{ margin-top:6px; padding-top:20px; border-top:1px solid var(--line-soft); display:flex; flex-direction:column; gap:16px; }
.ffx-option{ display:flex; align-items:center; gap:9px; cursor:pointer; font-family:var(--disp); font-size:14px; color:var(--bone); margin-bottom:6px; }
.ffx-option input{ accent-color:var(--ylw); }
.ffx-option-text{ color:var(--bone); }

/* ── Promo ── */
.ffx-promo-row{ display:flex; gap:10px; }
.ffx-promo-row .ffx-input{ flex:1; text-transform:uppercase; letter-spacing:0.08em; }
.ffx-btn-ghost{
  flex-shrink:0; padding:0 20px; border:1px solid var(--line); border-radius:10px; background:transparent;
  color:var(--wht); font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase; cursor:pointer; transition:border-color .15s ease, color .15s ease;
}
.ffx-btn-ghost:hover:not(:disabled){ border-color:var(--ylw); color:var(--ylw); }
.ffx-btn-ghost:disabled{ opacity:0.4; cursor:default; }
.ffx-promo-ok{
  display:flex; align-items:center; justify-content:space-between; gap:14px;
  border:1px solid rgba(76,159,55,0.4); background:rgba(76,159,55,0.1);
  border-radius:10px; padding:12px 14px;
}
.ffx-promo-ok-code{ margin:0; font-family:var(--mono); font-size:12px; font-weight:700; color:var(--grn); text-transform:uppercase; letter-spacing:0.06em; }
.ffx-promo-ok-sub{ margin:3px 0 0; font-size:12px; color:rgba(76,159,55,0.85); }
.ffx-link{ background:none; border:0; color:var(--bone); font-size:12px; text-decoration:underline; cursor:pointer; flex-shrink:0; }
.ffx-link:hover{ color:var(--wht); }

/* ── Summary ── */
.ffx-summary{ margin-top:34px; border:1px solid var(--line); border-radius:16px; padding:22px; background:var(--surf); }
.ffx-summary-lines{ display:flex; flex-direction:column; gap:8px; padding-bottom:16px; margin-bottom:16px; border-bottom:1px solid var(--line-soft); }
.ffx-summary-line{ display:flex; align-items:center; justify-content:space-between; font-size:13px; color:var(--bone); }
.ffx-summary-line.is-discount{ color:var(--grn); }
.ffx-total{ display:flex; align-items:baseline; justify-content:space-between; }
.ffx-total-label{ font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:var(--bone); }
.ffx-total-value{ font-family:var(--disp); font-weight:900; font-size:clamp(1.9rem,6vw,2.6rem); color:var(--ylw); letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }

/* ── Consent ── */
.ffx-consent{ display:flex; align-items:flex-start; gap:11px; margin-top:20px; cursor:pointer; }
.ffx-consent input{ margin-top:2px; width:16px; height:16px; accent-color:var(--ylw); flex-shrink:0; }
.ffx-consent span{ font-family:var(--disp); font-size:13.5px; line-height:1.5; color:var(--bone); }
.ffx-consent-box{ margin-top:20px; border:2px solid var(--ylw); border-radius:12px; padding:16px; background:rgba(255,184,1,0.08); }
.ffx-consent-box.is-accepted{ border-color:rgba(255,184,1,0.4); background:rgba(255,184,1,0.04); }
.ffx-consent-box .ffx-consent{ margin-top:0; }
.ffx-consent-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }
.ffx-consent-title{ font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:var(--bone); }
.ffx-consent-badge{ font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; background:var(--ylw); color:#1a1a1a; }
.ffx-consent-box.is-accepted .ffx-consent-badge{ background:rgba(255,184,1,0.2); color:var(--ylw); }
.ffx-consent-star{ color:#ff5a5a; font-weight:900; }
.ffx-consent-warn{ margin:8px 0 0 27px; font-family:var(--disp); font-size:12.5px; font-weight:600; color:var(--ylw); }

/* ── Pay ── */
.ffx-pay{ margin-top:34px; }
.ffx-alert{
  font-family:var(--mono); font-size:12px; color:#FF6B5A; border:1px solid rgba(255,107,90,0.4);
  background:rgba(255,107,90,0.08); border-radius:10px; padding:12px 14px; margin:0 0 16px;
}
.ffx-cta{
  width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:19px 24px; border:0; border-radius:14px; background:var(--ylw); color:#000;
  font-family:var(--disp); font-weight:900; font-size:16px; letter-spacing:0.02em; text-transform:uppercase;
  cursor:pointer; transition:transform .12s ease, filter .15s ease; font-variant-numeric:tabular-nums;
}
.ffx-cta:hover:not(:disabled){ filter:brightness(1.07); transform:translateY(-1px); }
.ffx-cta:active:not(:disabled){ transform:translateY(0); }
.ffx-cta:disabled{ opacity:0.4; cursor:default; }
.ffx-cta-arrow{ font-size:20px; line-height:1; }
.ffx-cta-alt{
  width:100%; margin-top:12px; display:flex; align-items:center; justify-content:center; gap:10px;
  padding:16px 24px; border:1px solid var(--line); border-radius:14px; background:transparent; color:var(--wht);
  font-family:var(--disp); font-weight:700; font-size:14px; letter-spacing:0.02em; text-transform:uppercase;
  cursor:pointer; transition:border-color .15s ease, color .15s ease;
}
.ffx-cta-alt:hover:not(:disabled){ border-color:rgba(255,255,255,0.32); }
.ffx-cta-alt:disabled{ opacity:0.4; cursor:default; }
.ffx-pay-note{ margin:16px 0 0; font-family:var(--mono); font-size:11px; line-height:1.6; color:var(--bone-faint); letter-spacing:0.02em; text-align:center; }

/* ── Footer (deck cover echo) ── */
.ffx-footer{
  margin-top:20px; padding:48px 22px 56px; text-align:center;
  border-top:1px solid var(--line-soft); background:#000;
}
.ffx-footer-mark{ height:20px; width:auto; margin:0 auto 18px; display:block; }
.ffx-footer-slogan{
  margin:0 0 20px; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; color:var(--ylw);
}
.ffx-footer-contact{
  margin:0; display:inline-flex; align-items:center; flex-wrap:wrap; justify-content:center; gap:10px;
  font-family:var(--mono); font-size:10.5px; letter-spacing:0.08em; color:var(--bone-faint);
}
.ffx-footer-contact .ffx-dot{ background:var(--bone-faint); }

/* ── Reveal ── */
.ffx-reveal{ animation:ffx-up .6s cubic-bezier(.2,.7,.2,1) both; }
@keyframes ffx-up{ from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:none} }
@media (prefers-reduced-motion: reduce){
  .ffx-reveal{ animation:none; }
  .ffx-marquee-track{ animation:none; }
}

/* ── Responsive ── */
@media (max-width:560px){
  .ffx-grid2{ grid-template-columns:1fr; }
  .ffx-ticket-main{ flex-wrap:wrap; }
  .ffx-ticket-action{ width:100%; margin-top:6px; }
  .ffx-coords{ gap:22px; }
  .ffx-topbar{ padding:14px 18px; }
  .ffx-topbar-tag{ white-space:nowrap; font-size:9px; letter-spacing:0.16em; }
  .ffx-hero{ padding:44px 0 34px; }
  .ffx-marquee-item{ font-size:12px; }
  .ffx-footer-contact{ flex-direction:column; gap:6px; }
}

/* ── Override globals.css's !important input/label chrome inside .ffx ──
   The app styles every input/textarea/select/label with !important and an
   old-amber focus ring. We prefix the global selectors with .ffx to raise
   specificity above them (the global input selector is (0,3,1); .ffx +
   the same :not() chain is (0,4,1)) so this bespoke surface stays true to
   the deck — near-black fields, bone labels in mono, a #FFB801 focus. */
.ffx input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
.ffx textarea,
.ffx select{
  background:var(--surf) !important;
  border:1px solid var(--line) !important;
  border-radius:10px !important;
  color:var(--wht) !important;
  font-family:var(--disp) !important;
  font-size:15px !important;
}
.ffx input:not([type="checkbox"]):not([type="radio"]):focus,
.ffx textarea:focus,
.ffx select:focus{
  border-color:var(--ylw) !important;
  box-shadow:0 0 0 3px rgba(255,184,1,0.16) !important;
  outline:none !important;
}
.ffx input::placeholder,
.ffx textarea::placeholder{ color:var(--bone-faint) !important; }
.ffx input.ffx-mono:not([type="checkbox"]):not([type="radio"]):not([type="range"]){
  font-family:var(--mono) !important; letter-spacing:0.08em !important;
}
.ffx label.ffx-cq-label{
  font-family:var(--mono) !important; font-size:10px !important; font-weight:700 !important;
  letter-spacing:0.18em !important; text-transform:uppercase !important; color:var(--bone) !important;
}
.ffx label.ffx-option{
  font-family:var(--disp) !important; font-size:14px !important; font-weight:400 !important;
  letter-spacing:normal !important; text-transform:none !important; color:var(--bone) !important;
}
.ffx .ffx-option-text{ text-transform:none !important; letter-spacing:normal !important; }
.ffx .ffx-consent span{ text-transform:none !important; letter-spacing:normal !important; }
.ffx .ffx-req{ color:var(--ylw) !important; }
`;
