"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { FormField } from "@/lib/forms/schema";
import { validateCheckoutAnswers } from "@/lib/ticketing/checkout-questions";
import { formatMoney, providersForCurrency } from "@/lib/currencies";
import {
  CheckoutQuestionFields,
  type CheckoutFieldClasses,
} from "./checkout-questions-fields";
import {
  TICKET_CONSENT_URL,
  TICKET_CONSENT_CHECKBOX_LABEL,
} from "@/lib/ticketing/consent-terms";

// Custom checkout questions render with the storefront's native input
// styling — globals.css covers inputs/selects/textareas, so plain
// utility classes match the buyer fields above.
const FF_CHECKOUT_CLASSES: CheckoutFieldClasses = {
  field: "",
  label: "",
  required: "",
  input: "w-full mt-1 px-3 py-2",
  textarea: "w-full mt-1 px-3 py-2",
  select: "w-full mt-1 px-3 py-2",
  optionRow:
    "flex items-center gap-2 cursor-pointer text-sm normal-case tracking-normal",
  optionText: "text-foreground/80 normal-case tracking-normal",
  help: "text-xs text-muted-foreground mt-1 normal-case tracking-normal",
  error: "text-sm text-red-500 mt-1 normal-case tracking-normal",
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
  /** For pwyw tiers: the buyer's chosen per-ticket amount in cents. */
  pwywAmountCents: number | null;
};

type AppliedPromo = {
  code: string;
  kind: "percent" | "fixed_amount" | "comp";
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
};

// In its sales window — controls public visibility. Sold-out tiers within
// the window stay visible (social proof). Tiers scheduled for later or
// already closed stay hidden so the marketing plan isn't on display.
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

export function Storefront({
  event,
  ticketTypes,
  checkoutQuestions,
}: {
  event: PublicEvent;
  ticketTypes: TicketType[];
  checkoutQuestions: FormField[];
}) {
  // Every price on this page is in the event's own currency, and
  // PayFast can only take ZAR — so a non-ZAR event is card-only.
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
  const [submitting, setSubmitting] = useState<"payfast" | "stripe" | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
  // to the cart (qty, tier add/remove) update the displayed total instantly.
  // Server re-validates and re-computes at /checkout.
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

  const buyerValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
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
      ? `${formatDate(event.start_date)} – ${formatDate(event.end_date)}`
      : formatDate(event.start_date);
  const timeRange =
    event.start_time && event.end_time
      ? `${formatTime(event.start_time)} – ${formatTime(event.end_time)}`
      : event.start_time
        ? formatTime(event.start_time)
        : null;

  // ── Render ──────────────────────────────────────────────────
  // Sits inside the (public) layout — that gives us a centred
  // max-w-2xl container on a bg-background page. We add nothing
  // exotic here; theme + typography flow from globals.css so
  // every input, label, and button matches the rest of the app.

  return (
    <div className="w-full space-y-4 animate-fade-up">
      {/* Event header */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-3">
          {event.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={event.logo_url}
              alt=""
              className="h-12 object-contain mb-1"
            />
          )}
          <p className="page-eyebrow">Event Tickets</p>
          <h1 className="page-title">{event.title}</h1>
          <p className="text-sm text-muted-foreground pt-1">
            {dateRange}
            {timeRange ? ` · ${timeRange}` : ""}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          {event.description && (
            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed pt-2">
              {event.description}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tickets available right now. Please check back soon.
            </p>
          ) : (
            <ul className="space-y-3">
              {visibleTickets.map((t) => {
                const onSale = isOnSale(t, now);
                const rem = remaining(t);
                const line = lines[t.id];
                const qty = line?.qty ?? 0;
                const isPwyw = t.pricing_mode === "pwyw";
                return (
                  <li
                    key={t.id}
                    className="rounded-md border border-border bg-background/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground normal-case tracking-normal">
                            {t.name}
                          </p>
                          {isPwyw && (
                            <span className="status-yellow text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded">
                              Pay what you want
                            </span>
                          )}
                          {!onSale && (
                            <span className="status-red text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded">
                              {rem === 0 ? "Sold out" : "Not on sale"}
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-1 normal-case tracking-normal">
                            {t.description}
                          </p>
                        )}
                        <p
                          className="text-sm font-semibold mt-2 normal-case tracking-normal"
                          style={{ color: "var(--yellow)" }}
                        >
                          {isPwyw
                            ? `Minimum ${money(t.display_price_cents)}`
                            : money(t.display_price_cents)}
                          {rem != null && rem > 0 && rem <= 10 && (
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] ml-2 opacity-80">
                              only {rem} left
                            </span>
                          )}
                        </p>
                      </div>
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
                          <Button
                            type="button"
                            onClick={() => setQty(t, 1)}
                            size="sm"
                          >
                            Add
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            onClick={() => setQty(t, 0)}
                            variant="outline"
                            size="sm"
                          >
                            Remove
                          </Button>
                        ))}
                    </div>
                    {isPwyw && qty > 0 && (
                      <div className="mt-3">
                        <label>{`Amount (${currency})`}</label>
                        <input
                          type="number"
                          step="0.01"
                          min={t.display_price_cents / 100}
                          defaultValue={(t.display_price_cents / 100).toFixed(2)}
                          onChange={(e) => setPwywAmount(t, e.target.value)}
                          className="w-full mt-1 px-3 py-2"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Promo + donation */}
      {visibleTickets.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <label>Promo or comp code (optional)</label>
              {appliedPromo ? (
                <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-green-700/40 bg-green-700/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold font-mono text-green-500 truncate">
                      {appliedPromo.code} applied
                    </p>
                    <p className="text-[11px] text-green-500/80">
                      {promoDiscountCents > 0
                        ? `−${money(promoDiscountCents)} off your order`
                        : appliedPromo.applies_to_ticket_type_id
                          ? "Add the matching tier to your cart to use this code."
                          : "No discount on the current cart."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removePromo}
                    className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <input
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
                    placeholder="Enter code"
                    className="flex-1 min-w-0 px-3 py-2 font-mono"
                  />
                  <Button
                    type="button"
                    onClick={applyPromo}
                    disabled={checkingPromo || !promoCode.trim()}
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                  >
                    {checkingPromo ? "Checking…" : "Apply"}
                  </Button>
                </div>
              )}
              {promoError && (
                <p className="text-xs mt-1.5 text-red-500">{promoError}</p>
              )}
            </div>
            <div>
              <label>{`Add a gift (${currency}, optional)`}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={donationRands}
                onChange={(e) => setDonationRands(e.target.value)}
                placeholder="0.00"
                className="w-full mt-1 px-3 py-2"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Total */}
      {lineCount > 0 && (
        <Card>
          <CardContent className="px-6 py-4 space-y-2">
            {(promoDiscountCents > 0 || donationCents > 0) && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono">{money(subtotalCents)}</span>
                </div>
                {promoDiscountCents > 0 && (
                  <div className="flex items-center justify-between text-green-500">
                    <span>Discount ({appliedPromo?.code})</span>
                    <span className="font-mono">
                      −{money(promoDiscountCents)}
                    </span>
                  </div>
                )}
                {donationCents > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Gift</span>
                    <span className="font-mono">+{money(donationCents)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Total
              </span>
              <span
                className="text-2xl font-display tracking-wide"
                style={{ color: "var(--yellow)" }}
              >
                {money(totalCents)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Buyer details */}
      {lineCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label>First name *</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full mt-1 px-3 py-2"
                />
              </div>
              <div>
                <label>Last name *</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full mt-1 px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 px-3 py-2"
              />
            </div>
            <div>
              <label>Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full mt-1 px-3 py-2"
              />
            </div>
            {checkoutQuestions.length > 0 && (
              <div className="space-y-4 border-t pt-4">
                <CheckoutQuestionFields
                  questions={checkoutQuestions}
                  values={customAnswers}
                  errors={customErrors}
                  onChange={(k, val) =>
                    setCustomAnswers((prev) => ({ ...prev, [k]: val }))
                  }
                  classes={FF_CHECKOUT_CLASSES}
                />
              </div>
            )}
            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              {/* Span carries the visible text so the global label
                  uppercase/tracking rule doesn't show. */}
              <span className="text-sm text-foreground/80 normal-case tracking-normal font-normal">
                Keep me posted on FFSA events and gatherings by email.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 accent-primary"
                required
              />
              <span className="text-sm text-foreground/80 normal-case tracking-normal font-normal">
                {TICKET_CONSENT_CHECKBOX_LABEL}{" "}
                <a
                  href={TICKET_CONSENT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Read the full terms.
                </a>
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {/* Pay */}
      {lineCount > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="text-xs text-muted-foreground normal-case tracking-normal">
              You'll be redirected to {canUsePayfast ? "PayFast" : "Stripe"} to
              complete payment securely.
            </p>
            {err && (
              <p className="text-sm rounded-md px-3 py-2 status-red normal-case tracking-normal">
                {err}
              </p>
            )}
            {canUsePayfast && (
              <Button
                type="button"
                onClick={() => submit("payfast")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                size="lg"
                className="w-full h-12"
              >
                {submitting === "payfast"
                  ? "Starting payment…"
                  : `Pay ${money(totalCents)} →`}
              </Button>
            )}
            {/* Stripe is the secondary option on a ZAR event and the
                only one on any other currency, so it takes over the
                primary styling when PayFast can't be offered. */}
            <div className={canUsePayfast ? "pt-1" : undefined}>
              <Button
                type="button"
                onClick={() => submit("stripe")}
                disabled={submitting !== null || !buyerValid || !consentAccepted}
                variant={canUsePayfast ? "outline" : "default"}
                size="lg"
                className={canUsePayfast ? "w-full h-11" : "w-full h-12"}
              >
                {submitting === "stripe"
                  ? "Starting payment…"
                  : canUsePayfast
                    ? "Pay with international card (Stripe) →"
                    : `Pay ${money(totalCents)} →`}
              </Button>
              {canUsePayfast && (
                <p className="text-[11px] text-muted-foreground normal-case tracking-normal mt-2 text-center">
                  Use this if your card was declined on PayFast, or for
                  international cards / Apple Pay.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components + helpers
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
    <div className="flex items-center gap-1 border border-border rounded-md bg-background/40 shrink-0">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty === 0}
        className="w-9 h-9 text-lg text-muted-foreground hover:text-foreground disabled:opacity-30 normal-case tracking-normal"
      >
        −
      </button>
      <span className="text-sm font-semibold w-6 text-center text-foreground tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        className="w-9 h-9 text-lg text-muted-foreground hover:text-foreground disabled:opacity-30 normal-case tracking-normal"
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
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
