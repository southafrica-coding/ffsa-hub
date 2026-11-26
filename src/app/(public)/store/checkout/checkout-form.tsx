"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatZar } from "@/lib/store/money";
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
  totalCents: number | null;
  needsShipping: boolean;
  fulfilment: "none" | "collect";
};

type Method = "payfast" | "eft" | "stripe";

const METHOD_COPY: Record<Method, { label: string; hint: string }> = {
  payfast: { label: "SA card", hint: "South African cards, through PayFast" },
  eft: { label: "EFT", hint: "Pay from a South African bank. We confirm it by hand." },
  stripe: { label: "International card", hint: "Cards from outside South Africa, through Stripe. Charged in rand." },
};

export function CheckoutForm({ methods, cancelled }: { methods: { card: boolean; eft: boolean; stripe: boolean }; cancelled: boolean }) {
  const router = useRouter();
  const { lines, ready, remove, clear } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const available = ([methods.card && "payfast", methods.eft && "eft", methods.stripe && "stripe"] as const).filter((m): m is Method => !!m);
  const [method, setMethod] = useState<Method>(available[0] ?? "payfast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      body: JSON.stringify({ lines: apiLines }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((q: Quote) => setQuote(q))
      .catch(() => {});
    return () => ctrl.abort();
  }, [apiLines, ready]);

  const shown = quote?.subtotalCents ?? 0;
  const open = available.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: apiLines,
          buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone || null },
          fulfilment: quote?.needsShipping ? "collect" : "none",
          paymentMethod: method,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.next) {
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
          <div className="section-bar"><span className="section-bar-title">Pay</span></div>
          <div className="space-y-3 border-x border-b border-rule p-4">
            {!open ? (
              <Notice>Checkout isn&apos;t open yet. Your cart will wait here.</Notice>
            ) : (
              <div className={cn("grid gap-2", available.length === 2 && "sm:grid-cols-2", available.length > 2 && "lg:grid-cols-3")}>
                {available.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} className={cn("min-h-16 border px-4 py-3 text-left transition-colors", method === m ? "border-ink bg-bone" : "border-rule-strong hover:border-ink")}>
                    <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em]">{METHOD_COPY[m].label}</span>
                    <span className="mt-1 block font-sans text-[13px] normal-case tracking-normal text-[color:var(--text-secondary)]">{METHOD_COPY[m].hint}</span>
                  </button>
                ))}
              </div>
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
          {quote?.needsShipping && (
            <div className="flex justify-between text-[13px]"><span>Collect at base</span><span>Free</span></div>
          )}
          <div className="flex items-end justify-between">
            <span className="mono-label">Total</span>
            <span className="numeral text-[36px]">{formatZar(shown)}</span>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {error && <Notice tone="bad">{error}</Notice>}
          <PrimaryButton type="submit" disabled={busy || !open || !quote || quote.items.some((i) => !i.ok)}>
            {busy ? "One moment…" : method === "eft" ? "Place order, pay by EFT" : method === "stripe" ? "Pay with international card" : "Pay with SA card"}
          </PrimaryButton>
          <p className="text-center text-[11px] text-[color:var(--text-tertiary)]">Prices in rand. We check every price again before you pay.</p>
        </div>
      </aside>
    </form>
  );
}
