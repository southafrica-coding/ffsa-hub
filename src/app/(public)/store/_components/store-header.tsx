"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useCart } from "./cart";

// White, flat, one hairline. The FF wordmark (never FFX), the word STORE,
// and two destinations: My Library and the cart.
export function StoreHeader() {
  const { count, ready } = useCart();
  const path = usePathname();
  const tab = (href: string, label: string, extra?: React.ReactNode) => {
    const active = path === href || path.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={cn(
          "relative inline-flex min-h-11 items-center gap-1.5 px-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors sm:px-3",
          active ? "text-ink" : "text-[color:var(--text-tertiary)] hover:text-ink"
        )}
      >
        {label}
        {extra}
        {active && <span className="absolute inset-x-2.5 bottom-1.5 h-[2px] bg-yellow sm:inset-x-3" />}
      </Link>
    );
  };
  return (
    <header className="sticky top-0 z-30 border-b border-ink bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 md:h-16 md:px-8">
        <Link href="/store" className="group flex min-w-0 items-center gap-3" aria-label="Fire & Fragrance Store home">
          <Image src="/brand/ff-mark-black.png" alt="" width={28} height={28} className="h-7 w-7 object-contain sm:hidden" priority />
          <Image src="/brand/ff-wordmark-black.png" alt="Fire & Fragrance" width={150} height={18} className="hidden h-[18px] w-auto object-contain sm:block" priority />
          <span className="border-l border-ink pl-3 font-display text-[18px] font-black uppercase leading-none tracking-[0.02em] transition-colors group-hover:text-[color:var(--text-secondary)]">
            Store
          </span>
        </Link>
        <nav className="flex items-center">
          {tab("/store/library", "Library")}
          {tab(
            "/store/checkout",
            "Cart",
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center px-1 font-mono text-[10px] tabular-nums transition-colors",
                ready && count > 0 ? "bg-ink text-white" : "bg-bone text-[color:var(--text-tertiary)]"
              )}
              aria-label={`${count} in cart`}
            >
              {ready ? count : 0}
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
