"use client";

// The booking box on the item page (46b, and 47a-3's bottom bar on a phone):
// how many, what it comes to, the deposit. The cart itself arrives with
// checkout, so "Add to cart" is shown but can't be pressed yet.

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import { quote, type QuoteProduct, type QuoteSettings } from "@/lib/equipment/pricing";

export function ItemBooking({
  product,
  settings,
  from,
  to,
  free,
  stock,
  rangeText,
  allFreeFrom,
  variant,
}: {
  product: QuoteProduct;
  settings: QuoteSettings;
  from: string;
  to: string;
  free: number;
  stock: number;
  rangeText: string;
  /** When fewer than all are free: the first day all of them are. */
  allFreeFrom: string | null;
  variant: "box" | "bar";
}) {
  const [qty, setQty] = useState(free > 0 ? 1 : 0);
  const q = quote([{ product, quantity: Math.max(qty, 1) }], from, to, "external", settings);
  const total = q.lines[0].lineTotalCents;

  const stepper = (
    <div className="flex h-[46px] items-center rounded-[6px] border border-[color:var(--hire-line-strong)] md:h-[46px]">
      <button
        type="button"
        aria-label="One fewer"
        disabled={qty <= 1}
        onClick={() => setQty((n) => Math.max(1, n - 1))}
        className="flex h-full w-11 items-center justify-center text-[color:var(--hire-body)] disabled:text-[color:var(--hire-dim-edge)]"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-9 text-center text-[17px] font-bold text-[color:var(--hire-ink)]" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        aria-label="One more"
        disabled={qty >= free}
        onClick={() => setQty((n) => Math.min(free, n + 1))}
        className="flex h-full w-11 items-center justify-center text-[color:var(--hire-body)] disabled:text-[color:var(--hire-dim-edge)]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );

  const add = (
    <button
      type="button"
      disabled
      title="Booking online opens soon"
      className={cn(
        "flex h-[46px] flex-1 items-center justify-center rounded-[6px] px-4 text-[15px] font-bold md:h-[46px]",
        free > 0
          ? "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)] opacity-60"
          : "bg-[color:var(--hire-surface2)] text-[color:var(--hire-dim-edge)]"
      )}
    >
      {free > 0 ? `${variant === "bar" ? "Add" : "Add to cart"} · ${rands(total)}` : "Booked on these dates"}
    </button>
  );

  const limitNote =
    free > 0 && qty >= free && free < stock
      ? `That's all we have free${allFreeFrom ? `. All ${stock} are free from ${allFreeFrom}.` : "."}`
      : null;

  if (variant === "bar") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          {free > 0 && stepper}
          {add}
        </div>
        <div className="text-[12px] text-[color:var(--hire-muted)]">
          {limitNote ?? "Booking online opens soon."}
          {product.deposit_cents > 0 && ` · deposit ${rands(product.deposit_cents)} each`}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-[8px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface)] p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium text-[color:var(--hire-ink)]">{rangeText}</span>
        <a href="#dates" className="text-[13px] underline underline-offset-4">
          Change
        </a>
      </div>
      <div
        className={cn(
          "text-[14px]",
          free === 0 ? "text-[color:var(--hire-ink)]" : free < stock ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ok)]"
        )}
      >
        {free === 0 ? "None free on these dates" : free < stock ? `${free} of ${stock} free on these dates` : `${free} free on these dates`}
      </div>
      <div className="flex items-center gap-3.5">
        {free > 0 && stepper}
        {add}
      </div>
      <div className="text-[13px] text-[color:var(--hire-muted)]">{limitNote ?? "Booking online opens soon."}</div>
      {product.deposit_cents > 0 && (
        <div className="flex justify-between border-t border-[color:var(--hire-line2)] pt-3 text-[13px]">
          <span>Refundable deposit</span>
          <span className="text-[color:var(--hire-ink)]">{rands(product.deposit_cents)} each</span>
        </div>
      )}
    </div>
  );
}
