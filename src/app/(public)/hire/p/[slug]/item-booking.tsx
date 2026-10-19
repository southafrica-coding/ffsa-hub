"use client";

// The booking box on the item page (46b, and 47a-3's bottom bar on a phone):
// how many, what it comes to, the deposit, and Add to cart. Adding saves the
// line in this browser's cart and moves the cart onto this page's dates; the
// cart page re-checks everything else against them.

import { useState } from "react";
import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import { quote, type QuoteProduct, type QuoteSettings } from "@/lib/equipment/pricing";
import { addLine, emptyCart } from "@/lib/equipment/cart";
import { useCart } from "@/lib/equipment/use-cart";

export function ItemBooking({
  slug,
  product,
  settings,
  from,
  to,
  free,
  stock,
  rangeText,
  allFreeFrom,
  internalRate,
  variant,
}: {
  slug: string;
  product: QuoteProduct;
  settings: QuoteSettings;
  from: string;
  to: string;
  free: number;
  stock: number;
  rangeText: string;
  /** When fewer than all are free: the first day all of them are. */
  allFreeFrom: string | null;
  /** Signed-in ministry bookers see what their wing pays. */
  internalRate: boolean;
  variant: "box" | "bar";
}) {
  const [cart, setCart] = useCart();
  const inCart = cart?.lines.find((l) => l.productId === product.id)?.quantity ?? 0;
  const max = Math.max(0, free - (cart?.from === from && cart?.to === to ? inCart : 0));
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const n = Math.min(Math.max(qty, 1), Math.max(max, 1));
  const q = quote([{ product, quantity: n }], from, to, "external", settings);
  const total = q.lines[0].lineTotalCents;
  const internal = quote([{ product, quantity: n }], from, to, "internal", settings).lines[0].lineTotalCents;

  function add() {
    const base = cart && cart.lines.length > 0 ? { ...cart, from, to } : emptyCart(from, to);
    setCart(addLine(base, { productId: product.id, quantity: n }));
    setAdded(true);
    setQty(1);
  }

  const stepper = (
    <div className="flex h-[46px] items-center rounded-[6px] border border-[color:var(--hire-line-strong)]">
      <button
        type="button"
        aria-label="One fewer"
        disabled={n <= 1}
        onClick={() => setQty(Math.max(1, n - 1))}
        className="flex h-full w-11 items-center justify-center text-[color:var(--hire-body)] disabled:text-[color:var(--hire-dim)]"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-9 text-center text-[17px] font-bold text-[color:var(--hire-ink)]" aria-live="polite">
        {n}
      </span>
      <button
        type="button"
        aria-label="One more"
        disabled={n >= max}
        onClick={() => setQty(Math.min(max, n + 1))}
        className="flex h-full w-11 items-center justify-center text-[color:var(--hire-body)] disabled:text-[color:var(--hire-dim)]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );

  const addButton =
    max > 0 ? (
      <button
        type="button"
        onClick={add}
        className="flex h-[46px] flex-1 items-center justify-center rounded-[6px] bg-[color:var(--hire-accent)] px-4 text-[15px] font-bold text-[color:var(--hire-on-accent)]"
      >
        {variant === "bar" ? "Add" : "Add to cart"} · {rands(total)}
      </button>
    ) : (
      <span className="flex h-[46px] flex-1 items-center justify-center rounded-[6px] bg-[color:var(--hire-surface2)] px-4 text-[15px] font-bold text-[color:var(--hire-dim)]">
        {free > 0 ? "All free ones are in your cart" : "Booked on these dates"}
      </span>
    );

  const note = added ? (
    <span>
      Added.{" "}
      <Link href="/hire/cart" className="font-bold !text-[color:var(--hire-accent)] underline underline-offset-4">
        View cart
      </Link>
    </span>
  ) : n >= max && free > 0 && free < stock ? (
    `That's all we have free${allFreeFrom ? `. All ${stock} are free from ${allFreeFrom}.` : "."}`
  ) : inCart > 0 ? (
    `${inCart} already in your cart.`
  ) : null;

  if (variant === "bar") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          {max > 0 && stepper}
          {addButton}
        </div>
        <div className="text-[12px] text-[color:var(--hire-muted)]">
          {note ?? (internalRate ? `Your ministry rate: ${rands(internal)}` : "Prices excl. VAT")}
          {product.deposit_cents > 0 && !added && ` · deposit ${rands(product.deposit_cents)} each`}
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
        {max > 0 && stepper}
        {addButton}
      </div>
      {note && <div className="text-[13px] text-[color:var(--hire-muted)]">{note}</div>}
      {internalRate && (
        <div className="text-[13px] text-[color:var(--hire-ink)]">
          Your ministry rate: <b>{rands(internal)}</b> for these dates, no deposit. Choose it at checkout.
        </div>
      )}
      {product.deposit_cents > 0 && (
        <div className="flex justify-between border-t border-[color:var(--hire-line2)] pt-3 text-[13px]">
          <span>Refundable deposit</span>
          <span className="text-[color:var(--hire-ink)]">{rands(product.deposit_cents)} each</span>
        </div>
      )}
    </div>
  );
}
