"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatZar } from "@/lib/store/money";
import { PROVIDER_MIN_CENTS } from "@/lib/store/coupons";
import { useCart } from "../_components/cart";
import { Field, inputClass, Notice, PrimaryButton } from "../_components/ui";

type QuoteItem =
  | { ok: true; title: string; variant: string | null; quantity: number; unitCents: number; totalCents: number; ships: boolean; productId: string; cover: string | null }
  | { ok: false; title: string; error: string; productId: string };
type Quote = {
  items: QuoteItem[];
  ok: boolean;
  error: string | null;
  subtotalCents: number;
  deliveryCents?: number;
  discountCents?: number;
  totalCents: number | null;
  coupon?: { code: string; summary: string } | null;
  couponError?: string | null;
  needsShipping: boolean;
  fulfilment: "none" | "collect";
};

type Method = "payfast" | "eft" | "stripe";

const MIN_COPY: Record<"payfast" | "stripe", string> = {
  payfast: `Card payments start at ${formatZar(PROVIDER_MIN_CENTS.payfast)}.`,
  stripe: `International cards start at ${formatZar(PROVIDER_MIN_CENTS.stripe)}.`,
};

const METHOD_COPY: Record<Method, { label: string; hint: string }> = {
  payfast: { label: "SA card", hint: "South African cards, through PayFast" },
  eft: { label: "EFT", hint: "Pay from a South African bank. We confirm it by hand." },
  stripe: { label: "International card", hint: "Cards from outside South Africa, through Stripe. Charged in rand." },
};

export function CheckoutForm({
  methods,
  cancelled,
  enabled = methods.card || methods.eft || methods.stripe,
}: {
  methods: { card: boolean; eft: boolean; stripe: boolean };
  cancelled: boolean;
  /** Checkout is open at all (STORE_PAYMENTS_ENABLED). A free order needs no payment method. */
  enabled?: boolean;
}) {
  const router = useRouter();
  const { lines, ready, remove, clear } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const available = ([methods.card && "payfast", methods.eft && "eft", methods.stripe && "stripe"] as const).filter((m): m is Method => !!m);
  const [method, setMethod] = useState<Method>(available[0] ?? "payfast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Coupon: what's typed, and the code the server last accepted.
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const apiLines = useMemo(
    () => lines.map(({ productId, variantId, quantity, purpose, giftEmail, giftMessage }) => ({ productId, variantId: variantId ?? null, quantity, purpose, giftEmail: giftEmail ?? null, giftMessage: giftMessage ?? null })),
    [lines]
  );

  useEffect(() => {
    if (!ready) return;
    if (apiLines.length === 0) return setQuote(null);
    const ctrl = new AbortController();
    fetch("/api/store/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: apiLines, couponCode: applied }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((q: Quote) => {
        setQuote(q);
        // The cart changed under the code (e.g. its product was removed): drop it and say why.
        if (applied && q.couponError) {
          setApplied(null);
          setCodeError(q.couponError);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [apiLines, ready, applied]);

  // Only show a discount the latest quote priced for the code that's applied now.
  const discount = applied && quote?.coupon?.code === applied ? (quote.discountCents ?? 0) : 0;
  const total = Math.max(0, (quote?.subtotalCents ?? 0) + (quote?.deliveryCents ?? 0) - discount);
  const free = discount > 0 && total === 0;
  const tooSmall = (m: Method) => (m === "payfast" || m === "stripe") && total > 0 && total < PROVIDER_MIN_CENTS[m];
  const payable = available.filter((m) => !tooSmall(m));
  const open = free ? enabled : available.length > 0;
  const chosen: Method | null = payable.includes(method) ? method : (payable[0] ?? null);

  async function applyCode() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/store/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, lines: apiLines }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setCodeError(body.error ?? "We couldn't check that code. Try again.");
        return;
      }
      setApplied(body.code);
      setCodeInput(body.code);
    } catch {
      setCodeError("You look offline. Try again when you're connected.");
    } finally {
      setChecking(false);
    }
  }

  function removeCode() {
    setApplied(null);
    setCodeError(null);
    setCodeInput("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!free && !chosen) {
      setError(available.length ? "This total is too small for a card. Pay by EFT, or add something to your cart." : "Checkout isn't open yet.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: apiLines,
          buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone || null },
          fulfilment: quote?.needsShipping ? "collect" : "none",
          // A free order has no payment method: the server decides it's free.
          paymentMethod: free ? undefined : chosen,
          couponCode: applied,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.next) {
        if (body.coupon && applied) {
          // The code stopped working between the quote and the order.
          setApplied(null);
          setCodeError(body.error ?? null);
        }
        setError(body.error ?? "We couldn't start checkout. Try again.");
        return;
      }
      clear();
      if (/^https?:\/\//.test(body.next)) window.location.assign(body.next);
      else router.push(body.next);
    } catch {
      setError("You look offline. Try again when you're connected.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="mt-8 h-40 animate-pulse bg-bone-2" />;

  if (lines.length === 0) {
    return (
      <div className="mt-8 border border-dashed border-rule-strong px-5 py-12 text-center">
        <p className="font-display text-[30px] font-black uppercase leading-none">Your cart is empty</p>
        <Link href="/store" className="mt-5 inline-flex min-h-12 items-center border border-ink bg-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--ink-bg-hover)]">
          Back to the Store
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-8">
        {cancelled && <Notice>Payment cancelled. Nothing was charged. Your order is still here if you want to try again.</Notice>}

        <section>
          <div className="section-bar"><span className="section-bar-title">Your details</span></div>
          <div className="grid gap-4 border-x border-b border-rule p-4 sm:grid-cols-2">
            <Field label="Name">
              <input required autoComplete="name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Email" hint="Your library and receipts go here.">
              <input required type="email" autoComplete="email" inputMode="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Phone (optional)">
              <input type="tel" autoComplete="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </section>

        {quote?.needsShipping && (
          <section>
            <div className="section-bar"><span className="section-bar-title">Collect at base</span><span className="section-bar-meta">FREE</span></div>
            <div className="border-x border-b border-rule p-4">
              <div className="border-l-[3px] border-yellow pl-3">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Collect from reception at the base</p>
                <p className="mt-1 text-[14px]">We&apos;ll email you when your order is ready to collect.</p>
                <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">Potchefstroom. We don&apos;t deliver right now.</p>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="section-bar"><span className="section-bar-title">Coupon code</span></div>
          <div className="space-y-3 border-x border-b border-rule p-4">
            {applied && quote?.coupon ? (
              <div className="flex min-w-0 items-center justify-between gap-3 border-l-[3px] border-yellow bg-bone py-2 pl-3 pr-1">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">{quote.coupon.code}</p>
                  <p className="mt-0.5 text-[13px] text-[color:var(--text-secondary)]">{quote.coupon.summary}</p>
                </div>
                <button type="button" onClick={removeCode} className="inline-flex min-h-11 shrink-0 items-center px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline decoration-yellow decoration-2 underline-offset-4 hover:text-ink">
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label htmlFor="coupon-code" className="sr-only">Coupon code</label>
                <input
                  id="coupon-code"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value.toUpperCase());
                    setCodeError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyCode();
                    }
                  }}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  placeholder="WELCOME20"
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? "coupon-error" : undefined}
                  className={cn(inputClass, "min-w-0 flex-1 font-mono uppercase tracking-[0.08em]")}
                />
                <button
                  type="button"
                  onClick={() => void applyCode()}
                  disabled={checking || !codeInput.trim() || lines.length === 0}
                  className="inline-flex min-h-12 shrink-0 items-center border border-ink bg-white px-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checking ? "Checking…" : "Apply"}
                </button>
              </div>
            )}
            {codeError && (
              <p id="coupon-error" role="alert" className="text-[13px] text-destructive">
                {codeError}
              </p>
            )}
          </div>
        </section>

        <section>
          <div className="section-bar"><span className="section-bar-title">Pay</span></div>
          <div className="space-y-3 border-x border-b border-rule p-4">
            {free ? (
              open ? (
                <Notice tone="good">Your code covers the whole order. There&apos;s nothing to pay, so no card or bank details are needed.</Notice>
              ) : (
                <Notice>Checkout isn&apos;t open yet. Your cart will wait here.</Notice>
              )
            ) : !open ? (
              <Notice>Checkout isn&apos;t open yet. Your cart will wait here.</Notice>
            ) : (
              <>
                <div className={cn("grid gap-2", available.length === 2 && "sm:grid-cols-2", available.length > 2 && "lg:grid-cols-3")}>
                  {available.map((m) => {
                    const small = tooSmall(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={small}
                        onClick={() => setMethod(m)}
                        aria-pressed={chosen === m}
                        className={cn("min-h-16 border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", chosen === m ? "border-ink bg-bone" : "border-rule-strong hover:border-ink")}
                      >
                        <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em]">{METHOD_COPY[m].label}</span>
                        <span className="mt-1 block font-sans text-[13px] normal-case tracking-normal text-[color:var(--text-secondary)]">
                          {small ? MIN_COPY[m as "payfast" | "stripe"] : METHOD_COPY[m].hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!chosen && (
                  <Notice>This total is below what card payments allow. Add something to your cart{methods.eft ? ", or pay by EFT" : ""}.</Notice>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <aside className="md:sticky md:top-24 md:self-start">
        <div className="section-bar"><span className="section-bar-title">Your order</span><span className="section-bar-meta">{lines.length} {lines.length === 1 ? "LINE" : "LINES"}</span></div>
        <ul className="border-x border-rule">
          {lines.map((line, i) => {
            const q = quote?.items[i];
            return (
              <li key={line.key} className="flex gap-3 border-b border-rule p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[16px] font-black uppercase leading-tight">{q?.title ?? "…"}</p>
                  <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
                    {[
                      q && q.ok && q.variant,
                      line.purpose === "gift" ? `Gift for ${line.giftEmail}` : null,
                      line.purpose === "code_pack" ? `${line.quantity} codes` : null,
                      line.purpose === "self" && line.quantity > 1 ? `× ${line.quantity}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {q && !q.ok && <p className="mt-1 text-[12px] text-destructive">{q.error}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between">
                  <span className="numeral text-[17px]">{q && q.ok ? formatZar(q.totalCents) : ""}</span>
                  <button type="button" onClick={() => remove(line.key)} aria-label={`Remove ${q?.title ?? "item"}`} className="-mr-2 flex h-9 w-9 items-center justify-center text-[color:var(--text-tertiary)] hover:text-ink">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="space-y-1.5 border-x border-b border-ink bg-bone px-3 py-4">
          {discount > 0 && (
            <div className="flex justify-between text-[13px]"><span>Subtotal</span><span className="tabular-nums">{formatZar(quote?.subtotalCents ?? 0)}</span></div>
          )}
          {quote?.needsShipping && (
            <div className="flex justify-between text-[13px]"><span>Collect at base</span><span>Free</span></div>
          )}
          {discount > 0 && (
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate">Code {applied}</span>
              <span className="shrink-0 tabular-nums">− {formatZar(discount)}</span>
            </div>
          )}
          <div className="flex items-end justify-between">
            <span className="mono-label">{free ? "Nothing to pay" : "Total"}</span>
            <span className="numeral text-[36px]">{formatZar(total)}</span>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {error && <Notice tone="bad">{error}</Notice>}
          <PrimaryButton type="submit" disabled={busy || !open || !quote || quote.items.some((i) => !i.ok) || (!free && !chosen)}>
            {busy
              ? "One moment…"
              : free
                ? "Complete order"
                : chosen === "eft"
                  ? "Place order, pay by EFT"
                  : chosen === "stripe"
                    ? "Pay with international card"
                    : "Pay with SA card"}
          </PrimaryButton>
          <p className="text-center text-[11px] text-[color:var(--text-tertiary)]">Prices in rand. We check every price again before you pay.</p>
        </div>
      </aside>
    </form>
  );
}
