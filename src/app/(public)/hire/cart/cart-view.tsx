"use client";

// The cart (frames 46c, 47a-4). Re-checked on load and on every date change.
// A line that no longer fits is never dropped: it says why and offers named
// fixes — take fewer, swap for a similar free product, or remove — and
// checkout stays shut until every line is settled.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import { dayCount, rangeLabel, sastToday } from "@/lib/equipment/dates";
import { periodForDates, periodLabel } from "@/lib/equipment/pricing";
import { setQuantity, swapLine } from "@/lib/equipment/cart";
import { useCart } from "@/lib/equipment/use-cart";
import { Photo } from "../_components/photo";
import { useCheckedCart } from "../_components/use-checked-cart";

export function CartView() {
  const [cart, setCart, loaded] = useCart();
  const { data, error, loading } = useCheckedCart(cart);
  const today = sastToday();

  // Remember the last dates on which everything fitted, for "Go back".
  const lastFit = useRef<{ from: string; to: string } | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (data?.settled && cart) {
      lastFit.current = { from: cart.from, to: cart.to };
      force((n) => n + 1);
    }
  }, [data?.settled, cart]);

  if (!loaded) return <CartSkeleton />;

  if (!cart || cart.lines.length === 0) {
    return (
      <main className="px-[18px] py-12 md:px-10 md:py-16">
        <h1 className="hire-display text-[52px] md:text-[80px]">Cart</h1>
        <p className="mt-3 text-[16px]">Your cart is empty.</p>
        <Link href="/hire" className="mt-5 inline-flex h-12 items-center rounded-[8px] bg-[color:var(--hire-accent)] px-6 text-[15px] font-bold !text-[color:var(--hire-on-accent)]">
          Pick dates and browse
        </Link>
      </main>
    );
  }

  const lines = data?.lines ?? [];
  const waiting = lines.filter((l) => l.fit !== "fits").length + (data?.missing.length ?? 0);
  const settledCount = lines.filter((l) => l.fit === "fits").length;
  const q = data?.quote;
  const goBack =
    !data?.settled && lastFit.current && (lastFit.current.from !== cart.from || lastFit.current.to !== cart.to)
      ? lastFit.current
      : null;
  const range = rangeLabel(cart.from, cart.to);
  const period = periodLabel(periodForDates(cart.from, cart.to), dayCount(cart.from, cart.to));

  const setDates = (from: string, to: string) => {
    if (!from || !to || from < today) return;
    setCart({ ...cart, from, to: to < from ? from : to });
  };

  return (
    <main className="pb-[150px] md:pb-12">
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_400px] md:gap-10 md:px-10 md:pt-8">
        <section className="flex flex-col gap-3 px-[18px] pt-3 md:px-0 md:pt-0">
          <h1 className="hire-display text-[52px] md:text-[80px]">Cart</h1>

          {/* Dates: changing them re-checks every line. */}
          <div
            className={cn(
              "grid grid-cols-2 gap-[2px] overflow-hidden rounded-[8px] border bg-[color:var(--hire-line2)] text-[16px] font-medium text-[color:var(--hire-ink)]",
              data && !data.settled ? "border-[color:var(--hire-accent)]" : "border-[color:var(--hire-line-strong)]"
            )}
          >
            <label className="flex flex-col bg-[color:var(--hire-surface2)] px-3.5 py-2.5">
              <span className="hire-label">Collect</span>
              <input
                type="date"
                min={today}
                value={cart.from}
                onChange={(e) => setDates(e.target.value, cart.to)}
                className="hire-bare min-h-[28px] [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col bg-[color:var(--hire-surface2)] px-3.5 py-2.5">
              <span className="hire-label">Return</span>
              <input
                type="date"
                min={cart.from}
                value={cart.to}
                onChange={(e) => setDates(cart.from, e.target.value)}
                className="hire-bare min-h-[28px] [color-scheme:dark]"
              />
            </label>
          </div>

          {data?.internalAllowed && (
            <label className="flex min-h-[52px] items-center justify-between gap-4 rounded-[8px] border border-[color:var(--hire-line-strong)] px-3.5">
              <span className="text-[15px] text-[color:var(--hire-ink)]">
                Book for a ministry wing
                <span className="block text-[12px] text-[color:var(--hire-muted)]">Internal rate, no deposit, needs the rental manager&apos;s approval.</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={cart.internal === true}
                aria-label="Book for a ministry wing"
                onClick={() => setCart({ ...cart, internal: !cart.internal })}
                className={cn(
                  "relative h-7 w-[46px] shrink-0 rounded-[999px]",
                  cart.internal ? "bg-[color:var(--hire-accent)]" : "bg-[color:var(--hire-line-strong)]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] h-[22px] w-[22px] rounded-[999px]",
                    cart.internal ? "right-[3px] bg-[color:var(--hire-on-accent)]" : "left-[3px] bg-[color:var(--hire-muted)]"
                  )}
                />
              </button>
            </label>
          )}

          {error && <p className="text-[14px] text-[color:var(--hire-accent)]">{error}</p>}

          {waiting > 0 && (
            <div className="rounded-[8px] border border-[color:var(--hire-accent)] bg-[#221C10] px-3.5 py-3 text-[14px] leading-snug text-[color:var(--hire-ink)]">
              <b>
                {waiting} {waiting === 1 ? "line doesn't" : "lines don't"} fit {range}.
              </b>{" "}
              {goBack && (
                <>
                  Your old dates, {rangeLabel(goBack.from, goBack.to)}, still fit everything.{" "}
                  <button
                    type="button"
                    onClick={() => setDates(goBack.from, goBack.to)}
                    className="font-bold text-[color:var(--hire-accent)] underline underline-offset-4"
                  >
                    Go back to {rangeLabel(goBack.from, goBack.to)}
                  </button>
                </>
              )}
            </div>
          )}

          {!data && loading && <CartSkeletonLines />}

          <ul className="flex flex-col">
            {(data?.missing ?? []).map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 border-b border-[color:var(--hire-line)] py-3 text-[14px]">
                <span className="text-[color:var(--hire-ink)]">An item in your cart is no longer on the store.</span>
                <button
                  type="button"
                  onClick={() => setCart(setQuantity(cart, id, 0))}
                  className="h-11 rounded-[6px] border border-[color:var(--hire-line-strong)] px-4 text-[14px] text-[color:var(--hire-ink)]"
                >
                  Remove
                </button>
              </li>
            ))}
            {lines.map((l) => {
              const bad = l.fit !== "fits";
              return (
                <li
                  key={l.productId}
                  className={cn(
                    "grid grid-cols-[64px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-[color:var(--hire-line)] py-3 md:grid-cols-[96px_minmax(0,1fr)_auto]",
                    bad && "pl-3 shadow-[inset_3px_0_0_var(--hire-accent)]"
                  )}
                >
                  <Link href={`/hire/p/${l.slug}?from=${cart.from}&to=${cart.to}`}>
                    <Photo src={l.photo} alt={l.title} className="h-16 rounded-[6px] md:h-20" />
                  </Link>
                  <div className="min-w-0">
                    <Link href={`/hire/p/${l.slug}?from=${cart.from}&to=${cart.to}`} className="text-[15px] !text-[color:var(--hire-ink)]">
                      {l.quantity} × {l.title}
                    </Link>
                    <div
                      className={cn(
                        "mt-0.5 text-[12px]",
                        bad ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ok)]"
                      )}
                    >
                      {l.fit === "fits"
                        ? `Still free${l.free > l.quantity ? "" : ` · ${l.free} of ${l.stock}`}`
                        : l.fit === "short"
                          ? `You asked for ${l.quantity}. Only ${l.free} ${l.free === 1 ? "is" : "are"} free on ${range}.`
                          : `All ${l.stock} are booked on ${range}.`}
                    </div>
                    {!bad && (
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex h-11 items-center rounded-[6px] border border-[color:var(--hire-line-strong)]">
                          <button
                            type="button"
                            aria-label="One fewer"
                            onClick={() => setCart(setQuantity(cart, l.productId, l.quantity - 1))}
                            className="flex h-full w-11 items-center justify-center"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-7 text-center font-bold text-[color:var(--hire-ink)]">{l.quantity}</span>
                          <button
                            type="button"
                            aria-label="One more"
                            disabled={l.quantity >= l.free}
                            onClick={() => setCart(setQuantity(cart, l.productId, l.quantity + 1))}
                            className="flex h-full w-11 items-center justify-center disabled:text-[color:var(--hire-dim)]"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart(setQuantity(cart, l.productId, 0))}
                          className="h-11 text-[13px] underline underline-offset-4"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "hire-display text-right text-[22px]",
                      bad && "!text-[color:var(--hire-muted)] line-through"
                    )}
                  >
                    {rands(l.lineTotalCents)}
                  </span>

                  {bad && (
                    <div className="col-span-3 flex flex-wrap gap-2">
                      {l.fit === "short" && (
                        <button
                          type="button"
                          onClick={() => setCart(setQuantity(cart, l.productId, l.free))}
                          className="h-11 rounded-[6px] bg-[color:var(--hire-accent)] px-4 text-[14px] font-bold text-[color:var(--hire-on-accent)]"
                        >
                          Take {l.free}
                        </button>
                      )}
                      {l.swap && (
                        <button
                          type="button"
                          onClick={() => setCart(swapLine(cart, l.productId, l.swap!.productId))}
                          className={cn(
                            "h-11 rounded-[6px] px-4 text-left text-[14px]",
                            l.fit === "none"
                              ? "bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
                              : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
                          )}
                        >
                          Swap for {l.quantity} × {l.swap.title} ·{" "}
                          {l.swap.unitPriceCents === l.unitPriceCents
                            ? "same price"
                            : `${rands(l.swap.unitPriceCents * l.quantity)}`}
                          , free
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setCart(setQuantity(cart, l.productId, 0))}
                        className="h-11 rounded-[6px] border border-[color:var(--hire-line-strong)] px-4 text-[14px] text-[color:var(--hire-ink)]"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Summary (desktop column; on a phone, totals then a bottom bar). */}
        <aside className="mt-4 px-[18px] md:mt-[96px] md:px-0">
          <div className="flex flex-col gap-2 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-[18px] text-[14px]">
            <div className="hire-label">
              {cart.internal ? "Ministry rate" : <span className="capitalize">{period}</span>} · {range}
            </div>
            <Row label={`Hire, ${settledCount} ${settledCount === 1 ? "line" : "lines"} settled`} value={q ? rands(q.subtotalCents) : "…"} />
            {waiting > 0 && (
              <div className="text-[13px] text-[color:var(--hire-accent)]">
                {waiting} {waiting === 1 ? "line is" : "lines are"} waiting on you
              </div>
            )}
            {q && q.waiverCents > 0 && (
              <Row label={`Damage waiver, ${(data!.settings.waiver_bps / 100).toString()}%`} value={rands(q.waiverCents)} />
            )}
            {q && <Row label={`VAT, ${(data!.settings.vat_bps / 100).toString()}%`} value={rands(q.vatCents)} />}
            <div className="mt-1 flex items-baseline justify-between border-t border-[color:var(--hire-line2)] pt-2">
              <span className="text-[color:var(--hire-ink)]">{waiting > 0 ? "So far" : "Hire total"}</span>
              <span className="hire-display text-[30px]">{q ? rands(q.totalCents) : "…"}</span>
            </div>
            {q && q.depositCents > 0 && <Row label="Refundable deposit, held at checkout" value={rands(q.depositCents)} />}
            {cart.internal && <p className="text-[12px] text-[color:var(--hire-muted)]">No deposit for ministry wings. Damage is charged to the wing.</p>}
            <div className="hidden md:block">
              <CheckoutButton ready={!!data?.settled && !loading} waiting={waiting} loading={loading} />
            </div>
          </div>
        </aside>
      </div>

      <div
        className="fixed inset-x-0 z-30 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-3 md:hidden"
        style={{ bottom: "calc(58px + max(10px, env(safe-area-inset-bottom, 0px)))" }}
      >
        <div className="mb-2 flex items-baseline justify-between text-[14px]">
          <span>{waiting > 0 ? "So far, incl. VAT" : "Hire total, incl. VAT"}</span>
          <span className="hire-display text-[24px]">{q ? rands(q.totalCents) : "…"}</span>
        </div>
        <CheckoutButton ready={!!data?.settled && !loading} waiting={waiting} loading={loading} />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-[color:var(--hire-ink)]">{value}</span>
    </div>
  );
}

function CheckoutButton({ ready, waiting, loading }: { ready: boolean; waiting: number; loading: boolean }) {
  if (ready) {
    return (
      <Link
        href="/hire/checkout"
        className="mt-2 flex h-[52px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] text-[16px] font-bold !text-[color:var(--hire-on-accent)]"
      >
        Check out
      </Link>
    );
  }
  return (
    <span className="mt-2 flex h-[52px] items-center justify-center gap-2 rounded-[8px] bg-[color:var(--hire-surface2)] text-[15px] font-bold text-[color:var(--hire-dim)]">
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your dates
        </>
      ) : waiting > 0 ? (
        `Settle ${waiting} ${waiting === 1 ? "line" : "lines"} to check out`
      ) : (
        "Check out"
      )}
    </span>
  );
}

function CartSkeletonLines() {
  return (
    <div className="flex flex-col">
      {[0, 1].map((i) => (
        <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-[color:var(--hire-line)] py-3">
          <div className="h-16 animate-pulse rounded-[6px] bg-[color:var(--hire-surface2)]" />
          <div className="flex flex-col gap-2">
            <span className="h-[13px] w-3/4 animate-pulse rounded-[3px] bg-[#231F19]" />
            <span className="h-[11px] w-1/3 animate-pulse rounded-[3px] bg-[#1F1B16]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CartSkeleton() {
  return (
    <main className="px-[18px] pt-3 md:px-10 md:pt-8" aria-busy="true">
      <div className="h-12 w-32 animate-pulse rounded-[4px] bg-[color:var(--hire-surface2)] md:h-20" />
      <div className="mt-3 h-[58px] animate-pulse rounded-[8px] bg-[color:var(--hire-surface2)]" />
      <CartSkeletonLines />
    </main>
  );
}
