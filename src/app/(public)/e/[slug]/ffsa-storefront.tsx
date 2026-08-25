"use client";

import { useMemo, useState } from "react";
import { PhoneInputNative } from "@/components/ui/phone-input-native";
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
import { FFSA_BRAND, FFSA_COLORS, FFSA_LOGOS } from "@/lib/brand/ffsa";
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
// FIRE & FRAGRANCE — public event page (frame 4c)
// ============================================================
// The generic F&F storefront (brand='ff', also the default). This is the
// only surface outsiders see, so it is the one place the editorial system
// runs at full volume — 118px condensed title, a facts strip, and the
// registration form inline rather than behind a click.
//
// Recomposed onto the Hub's editorial design system (docs/redesign, frame
// 4c). It deliberately does NOT compose src/components/ffsa: those
// primitives assume the signed-in admin shell (Masthead's black rule, the
// one-NeedsYou-per-screen rule, the 74px rail). This page owns the full
// viewport and injects its own scoped CSS, exactly as its five siblings do.
// What it shares with them is the token vocabulary, not the components.
//
// The five bespoke event brands (the_send, ffsa_camps, preachers,
// wild_ones, missio) keep their own fonts and colours and are untouched —
// event brand kits are out of scope for the redesign.
//
// Structure, straight from the frame:
//   - black top bar, white FF wordmark, yellow REGISTER
//   - full-bleed masthead: photo layer, 0.35 → 0.94 black gradient,
//     yellow event tag, 118px condensed title, CTA + seat count
//   - facts strip: four bone cells, mono label over a 16px value
//   - body: copy left, registration form inline right (520px)
//   - black footer carrying the deck's contact row
//
// Checkout behaviour (PWYW, promo, gift, currency, PayFast/Stripe routing,
// custom questions, tier questions, waivers, consent) is unchanged from the
// previous pass — only the presentation was rebuilt.
// ============================================================

const FFE_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "ffe-field",
  // Not `ffe-label`: the frame's mono micro-label is sized for field names
  // ("FIRST NAME"), and organizers write questions as whole sentences
  // ("Are you attending alone, with your spouse, or as a family?"). Those
  // get body type instead — see .ffe-qlabel.
  label: "ffe-qlabel",
  required: "ffe-req",
  input: "ffe-input",
  textarea: "ffe-input ffe-textarea",
  select: "ffe-input ffe-select",
  optionRow: "ffe-option",
  optionText: "ffe-option-text",
  help: "ffe-help",
  error: "ffe-err",
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
  max_capacity?: number | null;
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

/** 1140 → "1 140". The frame sets every figure with a thin space. */
function groupDigits(n: number): string {
  return n.toLocaleString("en-ZA").replace(/,/g, " ");
}

export function FfsaStorefront({
  event,
  ticketTypes,
  checkoutQuestions,
  buyerFields,
  heroImageUrl,
}: {
  event: PublicEvent;
  ticketTypes: TicketType[];
  checkoutQuestions: FormField[];
  buyerFields: BuyerFieldConfig[];
  /**
   * The masthead's full-bleed photo. The frame calls for one, but `events`
   * has no hero-photo column yet (logo_url is a brand mark, not a cover),
   * so today this is always undefined and the masthead renders as its black
   * ground — the gradient and the 118px title carry it. Wired as a prop so
   * adding the column later is a one-line change in page.tsx, with no
   * rework here.
   */
  heroImageUrl?: string | null;
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

  // A 100% comp code (or any discount that zeroes the total) means there's
  // nothing to charge — the checkout API settles the order inline, so the
  // buyer never sees a payment provider. Carried over from main; the 4c
  // rebuild must not regress it.
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
  const dateShort = formatDateShort(event.start_date);
  const timeRange =
    event.start_time && event.end_time
      ? `${formatTime(event.start_time)} – ${formatTime(event.end_time)}`
      : event.start_time
        ? formatTime(event.start_time)
        : null;

  // The hero's mono context line: place · date, the frame's
  // "CAPE TOWN · 02 SEPTEMBER 2026".
  const heroContext = [event.location, dateShort]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();

  // ── Real figures only ───────────────────────────────────────
  // The frame carries headline numerals (seats taken, and a stats row).
  // Every one here is derived from this event's own tiers — nothing is
  // invented, and a figure that cannot be computed simply does not render.
  const soldTotal = ticketTypes.reduce((s, t) => s + (t.quantity_sold ?? 0), 0);
  const tierCapacityTotal = ticketTypes.reduce(
    (s, t) => s + (t.capacity ?? 0),
    0
  );
  // Prefer the event's own cap; fall back to the sum of tier caps. Either
  // may be absent, in which case there is no ratio to draw.
  const seatCap =
    event.max_capacity && event.max_capacity > 0
      ? event.max_capacity
      : tierCapacityTotal > 0
        ? tierCapacityTotal
        : null;
  const seatPct =
    seatCap && seatCap > 0
      ? Math.min(100, Math.round((soldTotal / seatCap) * 100))
      : null;

  const cheapestCents = visibleTickets.length
    ? Math.min(...visibleTickets.map((t) => t.display_price_cents))
    : null;
  const costLabel =
    cheapestCents == null
      ? "—"
      : cheapestCents === 0
        ? "Free"
        : visibleTickets.length > 1
          ? `From ${money(cheapestCents)}`
          : money(cheapestCents);

  const daysToGo = daysUntil(event.start_date);

  // The four bone cells. WHEN and COST always hold; WHERE and DOORS only
  // appear when the event actually carries them, and the grid re-flows to
  // whatever is left rather than printing an em dash.
  const facts: Array<{ label: string; value: string }> = [
    { label: "WHEN", value: dateShort },
    ...(event.location ? [{ label: "WHERE", value: event.location }] : []),
    ...(timeRange ? [{ label: "DOORS", value: timeRange }] : []),
    { label: "COST", value: costLabel },
  ];

  // The left column's stats run, same rule: only what is real.
  const stats: Array<{ value: string; label: string }> = [
    ...(soldTotal > 0
      ? [{ value: groupDigits(soldTotal), label: "TICKETS TAKEN SO FAR" }]
      : []),
    ...(daysToGo != null && daysToGo >= 0
      ? [
          {
            value: groupDigits(daysToGo),
            label: daysToGo === 1 ? "DAY TO GO" : "DAYS TO GO",
          },
        ]
      : []),
    ...(visibleTickets.length > 0
      ? [
          {
            value: String(visibleTickets.length),
            label: visibleTickets.length === 1 ? "TICKET TYPE" : "TICKET TYPES",
          },
        ]
      : []),
  ];

  const paletteVars = {
    "--blk": FFSA_COLORS.BLACK,
    "--wht": FFSA_COLORS.WHITE,
    "--ylw": FFSA_COLORS.YELLOW,
  } as CSSProperties;

  return (
    <div
      className="ffe"
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
      <header className="ffe-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ffe-topbar-mark"
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
        />
        <a href="#register" className="ffe-topbar-cta">
          Register
        </a>
      </header>

      {/* ── MASTHEAD ────────────────────────────────────────── */}
      <section className="ffe-hero">
        {heroImageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="ffe-hero-photo" src={heroImageUrl} alt="" />
        )}
        <div className="ffe-hero-scrim" />
        <div className="ffe-hero-inner">
          {event.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="ffe-hero-logo" src={event.logo_url} alt="" />
          )}
          <div className="ffe-hero-tags">
            <span className="ffe-tag">Fire &amp; Fragrance</span>
            {heroContext && <span className="ffe-hero-context">{heroContext}</span>}
          </div>
          <h1 className="ffe-hero-title">{event.title}</h1>
          <div className="ffe-hero-actions">
            <a href="#register" className="ffe-hero-cta">
              {cheapestCents === 0 ? "Register free" : "Get your ticket"}
              <span className="ffe-hero-cta-arrow">→</span>
            </a>
            {seatCap != null && (
              <span className="ffe-hero-seats">
                {groupDigits(soldTotal)} of {groupDigits(seatCap)} seats taken
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── FACTS STRIP ─────────────────────────────────────── */}
      <div
        className="ffe-facts"
        style={{ "--facts": facts.length } as CSSProperties}
      >
        {facts.map((f) => (
          <div className="ffe-fact" key={f.label}>
            <div className="ffe-fact-label">{f.label}</div>
            <div className="ffe-fact-value">{f.value}</div>
          </div>
        ))}
      </div>

      {/* ── BODY + FORM ─────────────────────────────────────── */}
      <div className="ffe-body">
        <div className="ffe-copy">
          <div className="ffe-label">What it is</div>
          {/* The frame puts a 44px condensed statement here. The event's own
              headline is already 118px in the masthead two inches above, so
              repeating it would be noise — the description carries this
              column, and the condensed weight lands on the stats numerals
              below. An event with no description falls back to the title so
              the column is never bare. */}
          {event.description ? (
            <EventDescription
              html={event.description}
              className="ffe-desc is-lead"
            />
          ) : (
            <>
              <h2 className="ffe-copy-head">{event.title}</h2>
              <p className="ffe-desc">
                {dateLong}
                {event.location ? ` at ${event.location}` : ""}.
              </p>
            </>
          )}

          {stats.length > 0 && (
            <div className="ffe-stats">
              {stats.map((s) => (
                <div className="ffe-stat" key={s.label}>
                  <div className="ffe-stat-value">{s.value}</div>
                  <div className="ffe-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {seatPct != null && (
            <div className="ffe-capacity">
              <div className="ffe-label">Seats taken</div>
              <div className="ffe-capacity-row">
                <span className="ffe-capacity-num">{groupDigits(soldTotal)}</span>
                <span className="ffe-capacity-of">
                  / {groupDigits(seatCap!)}
                </span>
              </div>
              <div className="ffe-bar">
                <span style={{ width: `${seatPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── REGISTRATION, INLINE ──────────────────────────── */}
        <aside className="ffe-form" id="register">
          <div className="ffe-label">
            Registration
            {cheapestCents === 0 ? " · Free" : ""}
          </div>
          <h2 className="ffe-form-head">Save your seat</h2>

          {/* Tickets */}
          {visibleTickets.length === 0 ? (
            <p className="ffe-empty">
              No tickets available right now. Check back soon.
            </p>
          ) : (
            <ul className="ffe-tickets">
              {visibleTickets.map((t) => {
                const onSale = isOnSale(t, now);
                const rem = remaining(t);
                const line = lines[t.id];
                const qty = line?.qty ?? 0;
                const isPwyw = t.pricing_mode === "pwyw";
                const selected = qty > 0;
                return (
                  <li
                    key={t.id}
                    className={`ffe-ticket${selected ? " is-selected" : ""}${
                      !onSale ? " is-off" : ""
                    }`}
                  >
                    <div className="ffe-ticket-main">
                      <div className="ffe-ticket-info">
                        <div className="ffe-ticket-nameline">
                          <span className="ffe-ticket-name">{t.name}</span>
                          {isPwyw && (
                            <span className="ffe-badge">Pay what you want</span>
                          )}
                          {!onSale && (
                            <span className="ffe-badge is-off">
                              {rem === 0 ? "Sold out" : "Not on sale"}
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <p className="ffe-ticket-desc">{t.description}</p>
                        )}
                        <p className="ffe-ticket-price">
                          {isPwyw
                            ? `From ${money(t.display_price_cents)}`
                            : money(t.display_price_cents)}
                          {rem != null && rem > 0 && rem <= 10 && (
                            <span className="ffe-ticket-left">
                              Only {rem} left
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ffe-ticket-action">
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
                              className="ffe-add"
                              onClick={() => setQty(t, 1)}
                            >
                              Add
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="ffe-add is-remove"
                              onClick={() => setQty(t, 0)}
                            >
                              Remove
                            </button>
                          ))}
                      </div>
                    </div>
                    {isPwyw && qty > 0 && (
                      <div className="ffe-pwyw">
                        <label className="ffe-label">
                          Your amount ({currency})
                        </label>
                        <input
                          className="ffe-input"
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

          {/* Promo + gift */}
          {visibleTickets.length > 0 && (
            <div className="ffe-group">
              <div className="ffe-field">
                <label className="ffe-label">Promo or comp code</label>
                {appliedPromo ? (
                  <div className="ffe-promo-ok">
                    <div>
                      <p className="ffe-promo-ok-code">
                        {appliedPromo.code} applied
                      </p>
                      <p className="ffe-promo-ok-sub">
                        {promoDiscountCents > 0
                          ? `−${money(promoDiscountCents)} off your order`
                          : appliedPromo.applies_to_ticket_type_id
                            ? "Add the matching tier to use this code."
                            : "No discount on the current cart."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ffe-link"
                      onClick={removePromo}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="ffe-promo-row">
                    <input
                      className="ffe-input ffe-mono"
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
                      className="ffe-btn-ghost"
                      onClick={applyPromo}
                      disabled={checkingPromo || !promoCode.trim()}
                    >
                      {checkingPromo ? "Checking…" : "Apply"}
                    </button>
                  </div>
                )}
                {promoError && <p className="ffe-err">{promoError}</p>}
              </div>

              <div className="ffe-field">
                <label className="ffe-label">Add a gift ({currency})</label>
                <input
                  className="ffe-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={donationRands}
                  onChange={(e) => setDonationRands(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          {/* Summary */}
          {lineCount > 0 && (
            <div className="ffe-summary">
              {(promoDiscountCents > 0 || donationCents > 0) && (
                <div className="ffe-summary-lines">
                  <div className="ffe-summary-line">
                    <span>Subtotal</span>
                    <span className="ffe-mono">{money(subtotalCents)}</span>
                  </div>
                  {promoDiscountCents > 0 && (
                    <div className="ffe-summary-line is-discount">
                      <span>Discount · {appliedPromo?.code}</span>
                      <span className="ffe-mono">
                        −{money(promoDiscountCents)}
                      </span>
                    </div>
                  )}
                  {donationCents > 0 && (
                    <div className="ffe-summary-line">
                      <span>Gift</span>
                      <span className="ffe-mono">+{money(donationCents)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="ffe-total">
                <span className="ffe-total-label">Total</span>
                <span className="ffe-total-value">{money(totalCents)}</span>
              </div>
            </div>
          )}

          {/* Buyer details */}
          {lineCount > 0 && (
            <div className="ffe-group">
              {(bf.first_name.enabled || bf.last_name.enabled) && (
                <div className="ffe-grid2">
                  {bf.first_name.enabled && (
                    <div className="ffe-field">
                      <label className="ffe-label">
                        First name
                        {bf.first_name.required && (
                          <span className="ffe-req"> *</span>
                        )}
                      </label>
                      <input
                        className="ffe-input"
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </div>
                  )}
                  {bf.last_name.enabled && (
                    <div className="ffe-field">
                      <label className="ffe-label">
                        Last name
                        {bf.last_name.required && (
                          <span className="ffe-req"> *</span>
                        )}
                      </label>
                      <input
                        className="ffe-input"
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="ffe-field">
                <label className="ffe-label">
                  Email<span className="ffe-req"> *</span>
                </label>
                <input
                  className="ffe-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {bf.phone.enabled && (
                <div className="ffe-field">
                  <label className="ffe-label">
                    Phone
                    {bf.phone.required && <span className="ffe-req"> *</span>}
                  </label>
                  <PhoneInputNative
                    value={phone}
                    onChange={setPhone}
                    selectClassName="ffe-input"
                    inputClassName="ffe-input"
                  />
                </div>
              )}

              {checkoutQuestions.length > 0 && (
                <div className="ffe-subblock">
                  <CheckoutQuestionFields
                    questions={checkoutQuestions}
                    values={customAnswers}
                    errors={customErrors}
                    onChange={(k, val) =>
                      setCustomAnswers((prev) => ({ ...prev, [k]: val }))
                    }
                    classes={FFE_CHECKOUT_CLASSES}
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
                <div className="ffe-subblock">
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
                    classes={FFE_CHECKOUT_CLASSES}
                    titleClassName="ffe-label"
                  />
                </div>
              )}

              {bf.marketing_consent.enabled && (
                <label className="ffe-consent">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                  />
                  <span>
                    Keep me posted about schools, outreaches and events in my
                    area.
                  </span>
                </label>
              )}

              <div
                className={`ffe-consent-box${consentAccepted ? " is-accepted" : ""}`}
              >
                <div className="ffe-consent-head">
                  <span className="ffe-consent-title">
                    Required before you can pay
                  </span>
                  <span className="ffe-consent-badge">
                    {consentAccepted ? "✓ Accepted" : "Required"}
                  </span>
                </div>
                <label className="ffe-consent">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    required
                  />
                  <span>
                    <span className="ffe-consent-star">* </span>
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
                  <p className="ffe-consent-warn">
                    Please tick this box to enable the payment button below.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Pay */}
          {lineCount > 0 && (
            <div className="ffe-pay">
              {err && <p className="ffe-alert">{err}</p>}
              {isFreeOrder ? (
                <>
                  <button
                    type="button"
                    className="ffe-cta"
                    onClick={() => submit(canUsePayfast ? "payfast" : "stripe")}
                    disabled={
                      submitting !== null || !buyerValid || !consentAccepted
                    }
                  >
                    <span>
                      {submitting !== null
                        ? "Issuing tickets…"
                        : "Get my tickets"}
                    </span>
                    <span className="ffe-cta-arrow">→</span>
                  </button>
                  <p className="ffe-pay-note">
                    Your code covers this in full — nothing to pay. We&apos;ll
                    email your tickets straight away.
                  </p>
                </>
              ) : (
                <>
              {canUsePayfast && (
                <button
                  type="button"
                  className="ffe-cta"
                  onClick={() => submit("payfast")}
                  disabled={submitting !== null || !buyerValid || !consentAccepted}
                >
                  <span>
                    {submitting === "payfast"
                      ? "Starting payment…"
                      : `Pay ${money(totalCents)}`}
                  </span>
                  <span className="ffe-cta-arrow">→</span>
                </button>
              )}
              <button
                type="button"
                className={canUsePayfast ? "ffe-cta-alt" : "ffe-cta"}
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
                {!canUsePayfast && <span className="ffe-cta-arrow">→</span>}
              </button>
              <p className="ffe-pay-note">
                {canUsePayfast
                  ? "Secure checkout via PayFast. Use the international option for cards declined on PayFast or Apple Pay."
                  : "You'll be redirected to Stripe to complete payment securely."}
              </p>
                </>
              )}
            </div>
          )}

          {lineCount === 0 && visibleTickets.length > 0 && (
            <p className="ffe-form-note">
              Pick a ticket above and the rest of the form appears here.
            </p>
          )}
        </aside>
      </div>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="ffe-footer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ffe-footer-mark"
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
        />
        <p className="ffe-footer-contact">
          <span>{FFSA_BRAND.contact.instagram}</span>
          <i className="ffe-sep" />
          <span>{FFSA_BRAND.contact.website}</span>
        </p>
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quantity stepper — square, black on active
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
    <div className={`ffe-stepper${qty > 0 ? " is-active" : ""}`}>
      <button
        type="button"
        aria-label="Remove one"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
      >
        −
      </button>
      <span className="ffe-stepper-num">{qty}</span>
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
/** "02 Sep 2026" — the compact form the facts strip and hero line use. */
function formatDateShort(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
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
/** Whole days from today to the event. Null if the date won't parse. */
function daysUntil(dateStr: string): number | null {
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// ────────────────────────────────────────────────────────────
// Scoped CSS — everything lives under `.ffe`
// The editorial system's values, written out rather than imported, because
// this page renders outside the admin shell that defines them.
// ────────────────────────────────────────────────────────────
const scopedCss = `
.ffe{
  --disp: var(--font-roboto-condensed), 'Roboto Condensed', 'Arial Narrow', sans-serif;
  --mono: var(--font-roboto-mono), 'Roboto Mono', monospace;
  --body: var(--font-roboto), 'Roboto', sans-serif;
  --bone: #F4F2EA;
  --bone-3: #E7E4D9;
  --rule: #DEDACE;
  --rule-strong: #C7C3B5;
  --t2: #45423B;
  --t3: #7C786C;
  --dim: #C5C2AE;
  background: var(--wht);
  color: var(--blk);
  font-family: var(--body);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.ffe *{ box-sizing: border-box; }
.ffe img{ max-width:100%; }

/* ── Shared atoms ── */
/* globals.css carries an app-wide \`label { … !important }\` that puts every
   label into 9.5px mono caps. That is right for the admin screens it was
   written for, but this page renders outside that shell and carries
   sentence-length labels (questions, consent) that become unreadable under
   it. The overrides below win it back, scoped to .ffe so the shared rule —
   wanted by ~60 admin routes — is left exactly as it is. */
.ffe-label,
.ffe label.ffe-label{
  display:block; font-family:var(--mono) !important; font-size:9.5px !important;
  font-weight:700 !important; letter-spacing:0.2em !important;
  text-transform:uppercase !important; color:var(--t3) !important; margin-bottom:8px;
}
/* A question is body copy, not a field name. */
.ffe-qlabel,
.ffe label.ffe-qlabel{
  display:block; font-family:var(--body) !important; font-size:13.5px !important;
  font-weight:600 !important; letter-spacing:normal !important;
  text-transform:none !important; color:var(--blk) !important;
  line-height:1.45; margin-bottom:7px;
}
.ffe-mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
.ffe-req{ color:#8A6400 !important; }

/* ── Top bar ── */
.ffe-topbar{
  position:sticky; top:0; z-index:20;
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:13px 20px; background:var(--blk);
}
.ffe-topbar-mark{ width:118px; height:auto; display:block; }
.ffe-topbar-cta{
  background:var(--ylw); color:var(--blk); padding:9px 13px;
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.16em;
  text-transform:uppercase; text-decoration:none; min-height:38px;
  display:inline-flex; align-items:center;
}
.ffe-topbar-cta:hover{ background:#E8A800; color:var(--blk); }

/* ── Masthead ── */
.ffe-hero{
  position:relative; overflow:hidden; background:var(--blk);
  min-height:420px; display:flex;
}
@media (min-width:768px){ .ffe-hero{ min-height:520px; } }
.ffe-hero-photo{
  position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
}
.ffe-hero-scrim{
  pointer-events:none; position:absolute; inset:0;
  background:linear-gradient(180deg, rgba(10,10,10,0.35) 20%, rgba(10,10,10,0.94));
}
.ffe-hero-inner{
  position:relative; align-self:flex-end; width:100%; padding:24px 20px 28px;
}
@media (min-width:768px){ .ffe-hero-inner{ padding:48px; } }
.ffe-hero-logo{
  height:44px; width:auto; margin-bottom:18px; display:block;
  object-fit:contain; object-position:left;
}
@media (min-width:768px){ .ffe-hero-logo{ height:56px; } }
.ffe-hero-tags{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
.ffe-tag{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; background:var(--ylw); color:var(--blk); padding:5px 9px;
}
.ffe-hero-context{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.18em;
  color:var(--dim);
}
.ffe-hero-title{
  margin:0; font-family:var(--disp); font-weight:900;
  font-size:clamp(46px, 10.5vw, 118px);
  line-height:0.85; letter-spacing:-0.015em; text-transform:uppercase;
  color:var(--wht); max-width:1000px; overflow-wrap:anywhere;
}
.ffe-hero-actions{
  display:flex; align-items:center; gap:18px; flex-wrap:wrap; margin-top:22px;
}
.ffe-hero-cta{
  display:inline-flex; align-items:center; gap:12px; min-height:48px;
  background:var(--ylw); color:var(--blk); padding:14px 22px;
  font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.16em;
  text-transform:uppercase; text-decoration:none;
}
.ffe-hero-cta:hover{ background:#E8A800; color:var(--blk); }
.ffe-hero-cta-arrow{ font-size:13px; }
.ffe-hero-seats{
  font-family:var(--mono); font-size:11px; letter-spacing:0.12em;
  text-transform:uppercase; color:var(--dim); font-variant-numeric:tabular-nums;
}

/* ── Facts strip ── */
.ffe-facts{
  display:grid; grid-template-columns:repeat(2, 1fr);
  border-bottom:1px solid var(--blk); background:var(--bone);
}
@media (min-width:768px){
  .ffe-facts{ grid-template-columns:repeat(var(--facts, 4), 1fr); }
}
.ffe-fact{ padding:16px 20px; border-right:1px solid var(--rule); border-top:1px solid var(--rule); }
@media (min-width:768px){ .ffe-fact{ padding:20px 24px; border-top:none; } }
.ffe-fact:last-child{ border-right:none; }
.ffe-fact-label{
  font-family:var(--mono); font-size:9px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; color:var(--t3); margin-bottom:6px;
}
.ffe-fact-value{ font-size:16px; font-weight:700; color:var(--blk); letter-spacing:-0.01em; }

/* ── Body + form ── */
.ffe-body{ display:grid; grid-template-columns:1fr; }
@media (min-width:1024px){ .ffe-body{ grid-template-columns:1fr 520px; } }
.ffe-copy{ padding:28px 20px; }
@media (min-width:768px){ .ffe-copy{ padding:48px; } }
@media (min-width:1024px){ .ffe-copy{ border-right:1px solid var(--blk); } }
.ffe-copy-head{
  margin:0; font-family:var(--disp); font-weight:900;
  font-size:clamp(30px, 5vw, 44px); line-height:0.95; text-transform:uppercase;
  color:var(--blk); max-width:600px; overflow-wrap:anywhere;
}
.ffe-desc{
  font-size:16px; line-height:1.6; color:#2A2822; margin-top:20px; max-width:620px;
  text-wrap:pretty;
}
.ffe-desc a{ color:#000DE5; }
/* Leading the column rather than following a heading: the first paragraph
   sets the size the frame gives this copy, the rest settles back to body. */
.ffe-desc.is-lead{ margin-top:14px; }
.ffe-desc.is-lead > :first-child{ font-size:19px; line-height:1.5; color:var(--blk); }

.ffe-stats{
  display:flex; flex-wrap:wrap; gap:32px; margin-top:32px;
  border-top:1px solid var(--rule); padding-top:26px;
}
@media (min-width:768px){ .ffe-stats{ gap:40px; margin-top:36px; padding-top:28px; } }
.ffe-stat-value{
  font-family:var(--disp); font-weight:900; font-size:clamp(34px, 5vw, 44px);
  line-height:1; color:var(--blk); font-variant-numeric:tabular-nums;
}
.ffe-stat-label{
  font-family:var(--mono); font-size:9.5px; letter-spacing:0.16em;
  text-transform:uppercase; color:var(--t3); margin-top:3px;
}

.ffe-capacity{ margin-top:32px; border-top:1px solid var(--rule); padding-top:26px; max-width:420px; }
.ffe-capacity-row{ display:flex; align-items:baseline; gap:8px; }
.ffe-capacity-num{
  font-family:var(--disp); font-weight:900; font-size:44px; line-height:0.9;
  color:var(--blk); font-variant-numeric:tabular-nums;
}
.ffe-capacity-of{ font-family:var(--mono); font-size:11px; color:var(--t3); }
.ffe-bar{ height:8px; background:var(--bone-3); margin-top:12px; }
.ffe-bar > span{ display:block; height:8px; background:var(--blk); }

/* ── Registration panel ── */
.ffe-form{ background:var(--bone); padding:28px 20px; border-top:1px solid var(--blk); }
@media (min-width:768px){ .ffe-form{ padding:40px; } }
@media (min-width:1024px){ .ffe-form{ border-top:none; } }
.ffe-form-head{
  margin:0 0 22px; font-family:var(--disp); font-weight:900;
  font-size:34px; line-height:0.95; text-transform:uppercase; color:var(--blk);
}
.ffe-form-note{ margin:18px 0 0; font-size:13px; color:var(--t3); }
.ffe-empty{ margin:0; font-size:14px; color:var(--t2); }

.ffe-group{ margin-top:22px; display:flex; flex-direction:column; gap:14px; }
.ffe-subblock{ display:flex; flex-direction:column; gap:14px; }
.ffe-field{ display:block; }
.ffe-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }

.ffe-input{
  width:100%; border:1px solid var(--rule-strong); background:var(--wht);
  padding:12px 13px; font-size:15px; color:#45423B; font-family:var(--body);
  border-radius:0; min-height:46px;
}
.ffe-input:focus{ outline:none; border-color:var(--blk); box-shadow:inset 0 0 0 1px var(--blk); }
.ffe-textarea{ min-height:104px; resize:vertical; }
.ffe-select{ appearance:auto; }
.ffe-help{ margin:5px 0 0; font-size:12px; color:var(--t3); }
.ffe-err{ margin:5px 0 0; font-size:12px; color:#B3261E; }
.ffe-option,
.ffe label.ffe-option{
  display:flex; align-items:flex-start; gap:9px; margin-top:7px;
  min-height:26px; cursor:pointer;
  font-family:var(--body) !important; font-size:14px !important;
  font-weight:400 !important; letter-spacing:normal !important;
  text-transform:none !important; color:var(--t2) !important;
}
.ffe-option input{ margin-top:3px; width:16px; height:16px; accent-color:var(--blk); flex-shrink:0; }
.ffe-option-text{ font-size:14px; color:var(--t2); }

/* ── Tickets ── */
.ffe-tickets{ list-style:none; margin:0; padding:0; border-top:1px solid var(--rule-strong); }
.ffe-ticket{ border-bottom:1px solid var(--rule-strong); padding:15px 0; }
.ffe-ticket.is-selected{ background:rgba(255,184,1,0.10); }
.ffe-ticket.is-off{ opacity:0.55; }
.ffe-ticket-main{ display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
.ffe-ticket-info{ min-width:0; }
.ffe-ticket-nameline{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ffe-ticket-name{
  font-family:var(--disp); font-weight:900; font-size:19px; line-height:1;
  text-transform:uppercase; color:var(--blk);
}
.ffe-badge{
  font-family:var(--mono); font-size:8.5px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase; border:1px solid var(--blk); color:var(--blk); padding:3px 6px;
}
.ffe-badge.is-off{ border-color:var(--rule-strong); color:var(--t3); }
.ffe-ticket-desc{ margin:6px 0 0; font-size:13px; color:var(--t2); }
.ffe-ticket-price{
  margin:8px 0 0; font-family:var(--mono); font-size:13px; font-weight:700;
  color:var(--blk); font-variant-numeric:tabular-nums;
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
}
.ffe-ticket-left{
  font-size:9px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase;
  color:#8A6400; border:1px solid #B98600; padding:2px 5px;
}
.ffe-ticket-action{ flex-shrink:0; }

.ffe-stepper{
  display:flex; align-items:center; border:1px solid var(--rule-strong); background:var(--wht);
}
.ffe-stepper.is-active{ border-color:var(--blk); }
.ffe-stepper button{
  width:38px; height:44px; border:0; background:transparent; cursor:pointer;
  font-size:17px; color:var(--blk); font-family:var(--body);
}
.ffe-stepper button:disabled{ color:var(--rule-strong); cursor:not-allowed; }
.ffe-stepper-num{
  min-width:32px; text-align:center; font-family:var(--mono); font-weight:700;
  font-size:14px; font-variant-numeric:tabular-nums;
}
.ffe-add{
  min-height:44px; padding:11px 15px; border:1px solid var(--blk); background:var(--blk);
  color:var(--wht); cursor:pointer;
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase;
}
.ffe-add:hover{ background:#262622; }
.ffe-add.is-remove{ background:transparent; color:var(--blk); }
.ffe-add.is-remove:hover{ background:var(--bone-3); }
.ffe-pwyw{ margin-top:12px; }

/* ── Promo ── */
.ffe-promo-row{ display:flex; gap:8px; }
.ffe-promo-row .ffe-input{ text-transform:uppercase; letter-spacing:0.12em; }
.ffe-btn-ghost{
  flex-shrink:0; min-height:46px; padding:11px 15px;
  border:1px solid var(--blk); background:transparent; color:var(--blk); cursor:pointer;
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase;
}
.ffe-btn-ghost:hover:not(:disabled){ background:var(--blk); color:var(--wht); }
.ffe-btn-ghost:disabled{ opacity:0.4; cursor:not-allowed; }
.ffe-promo-ok{
  display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
  border:1px solid var(--blk); background:var(--wht); padding:12px 13px;
}
.ffe-promo-ok-code{
  margin:0; font-family:var(--mono); font-size:11px; font-weight:700;
  letter-spacing:0.12em; text-transform:uppercase; color:var(--blk);
}
.ffe-promo-ok-sub{ margin:3px 0 0; font-size:12.5px; color:var(--t2); }
.ffe-link{
  border:0; background:transparent; padding:0; cursor:pointer; text-decoration:underline;
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.12em;
  text-transform:uppercase; color:var(--t2);
}

/* ── Summary ── */
.ffe-summary{ margin-top:22px; border-top:1px solid var(--blk); padding-top:16px; }
.ffe-summary-lines{ display:flex; flex-direction:column; gap:7px; margin-bottom:12px; }
.ffe-summary-line{ display:flex; justify-content:space-between; gap:12px; font-size:13.5px; color:var(--t2); }
.ffe-summary-line.is-discount{ color:#2F6620; }
.ffe-total{
  display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  border-top:1px solid var(--rule-strong); padding-top:12px;
}
.ffe-total-label{
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.2em;
  text-transform:uppercase; color:var(--t3);
}
.ffe-total-value{
  font-family:var(--disp); font-weight:900; font-size:38px; line-height:0.9;
  color:var(--blk); font-variant-numeric:tabular-nums;
}

/* ── Consent ── */
.ffe-consent,
.ffe label.ffe-consent{
  display:flex; align-items:flex-start; gap:10px; cursor:pointer;
  font-family:var(--body) !important; font-size:12.5px !important;
  font-weight:400 !important; letter-spacing:normal !important;
  text-transform:none !important; color:var(--t2) !important; line-height:1.5;
}
.ffe-consent input{ margin-top:2px; width:16px; height:16px; accent-color:var(--blk); flex-shrink:0; }
.ffe-consent a{ color:#000DE5; text-decoration:underline; }
.ffe-consent-box{ border:1px solid var(--blk); background:var(--wht); padding:13px; display:flex; flex-direction:column; gap:9px; }
.ffe-consent-box.is-accepted{ background:rgba(62,127,43,0.06); }
.ffe-consent-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.ffe-consent-title{
  font-family:var(--mono); font-size:9.5px; font-weight:700; letter-spacing:0.16em;
  text-transform:uppercase; color:var(--blk);
}
.ffe-consent-badge{
  font-family:var(--mono); font-size:8.5px; font-weight:700; letter-spacing:0.14em;
  text-transform:uppercase; border:1px solid var(--rule-strong); color:var(--t3); padding:3px 6px;
}
.ffe-consent-box.is-accepted .ffe-consent-badge{ border-color:#3E7F2B; color:#2F6620; }
.ffe-consent-star{ color:#8A6400; font-weight:700; }
.ffe-consent-warn{ margin:0; font-size:11.5px; color:#8A6400; }

/* ── Pay ── */
.ffe-pay{ margin-top:22px; display:flex; flex-direction:column; gap:10px; }
.ffe-alert{
  margin:0; border:1px solid #B3261E; color:#B3261E; background:var(--wht);
  padding:10px 12px; font-size:13px;
}
.ffe-cta{
  display:flex; align-items:center; justify-content:center; gap:12px;
  width:100%; min-height:52px; padding:15px;
  border:1px solid var(--blk); background:var(--blk); color:var(--wht); cursor:pointer;
  font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.18em;
  text-transform:uppercase;
}
.ffe-cta:hover:not(:disabled){ background:#262622; }
.ffe-cta:disabled{ opacity:0.45; cursor:not-allowed; }
.ffe-cta-alt{
  display:flex; align-items:center; justify-content:center; gap:10px;
  width:100%; min-height:48px; padding:13px;
  border:1px solid var(--blk); background:transparent; color:var(--blk); cursor:pointer;
  font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.16em;
  text-transform:uppercase;
}
.ffe-cta-alt:hover:not(:disabled){ background:var(--bone-3); }
.ffe-cta-alt:disabled{ opacity:0.45; cursor:not-allowed; }
.ffe-cta-arrow{ font-size:13px; }
.ffe-pay-note{ margin:0; font-size:11.5px; color:var(--t3); text-align:center; line-height:1.5; }

/* ── Footer ── */
.ffe-footer{
  background:var(--blk); padding:26px 20px;
  display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;
}
@media (min-width:768px){ .ffe-footer{ padding:34px 48px; } }
.ffe-footer-mark{ width:110px; height:auto; display:block; }
.ffe-footer-contact{
  margin:0; display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  font-family:var(--mono); font-size:10px; letter-spacing:0.14em;
  text-transform:uppercase; color:#8E8A7C;
}
.ffe-sep{ display:inline-block; width:4px; height:4px; background:currentColor; opacity:0.7; }

@media (prefers-reduced-motion: reduce){
  .ffe *{ animation:none !important; transition:none !important; }
}
`;
