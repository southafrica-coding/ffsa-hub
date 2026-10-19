"use client";

// Storefront chrome (frames 44b, 46a, 47a): the header on desktop, the slim
// header + bottom tab bar on a phone (Home · Browse · Cart · Rentals). Every
// store link keeps the visitor's chosen dates; the cart count comes from
// this browser's saved cart.

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { cartCount, useCart } from "@/lib/equipment/use-cart";

type NavCategory = { slug: string; name: string };

function useDated() {
  const sp = useSearchParams();
  const from = sp.get("from");
  const to = sp.get("to");
  return (href: string) => (from && to ? `${href}?from=${from}&to=${to}` : href);
}

export function StoreHeader({
  categories,
  signedIn,
}: {
  categories: NavCategory[];
  signedIn: boolean;
}) {
  const dated = useDated();
  const pathname = usePathname() ?? "";
  const sp = useSearchParams();

  return (
    <>
      {/* Desktop */}
      <header className="hidden h-[68px] items-center gap-7 border-b border-[color:var(--hire-line)] px-10 md:flex">
        <Link href={dated("/hire")} className="flex items-center gap-3.5">
          <Image src="/brand/ff-wordmark-white.png" alt="Fire & Fragrance" width={150} height={22} style={{ height: 22, width: "auto" }} priority />
          <span className="hire-display pt-[3px] text-[22px] tracking-[0.08em] !text-[color:var(--hire-accent)]">HIRE</span>
        </Link>
        <form action="/hire/c/all" className="flex h-10 max-w-[440px] flex-1 items-center gap-2.5 rounded-[6px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface2)] px-3.5 text-[14px]">
          <Search className="h-[15px] w-[15px] shrink-0 text-[color:var(--hire-muted)]" />
          {sp.get("from") && <input type="hidden" name="from" value={sp.get("from")!} />}
          {sp.get("to") && <input type="hidden" name="to" value={sp.get("to")!} />}
          <input
            type="search"
            name="q"
            defaultValue={pathname === "/hire/c/all" ? sp.get("q") ?? "" : ""}
            placeholder="Search speakers, mics, screens…"
            aria-label="Search the store"
            className="hire-bare w-full min-w-0 outline-none"
          />
        </form>
        <nav className="flex gap-6 text-[14px] text-[color:var(--hire-body)]">
          {categories.map((c) => {
            const active = pathname === `/hire/c/${c.slug}`;
            return (
              <Link
                key={c.slug}
                href={dated(`/hire/c/${c.slug}`)}
                className={cn("hover:!text-[color:var(--hire-ink)]", active && "font-bold !text-[color:var(--hire-accent)]")}
              >
                {c.name}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[14px] text-[color:var(--hire-ink)]">
          {signedIn ? (
            <Link href="/dashboard" className="hover:underline">
              Hub
            </Link>
          ) : (
            <Link href={`/login?redirect=${encodeURIComponent(pathname || "/hire")}`} className="hover:underline">
              Sign in
            </Link>
          )}
          <CartButton />
        </div>
      </header>

      {/* Phone */}
      <header className="flex h-[52px] items-center gap-2.5 border-b border-[color:var(--hire-line)] px-[18px] md:hidden">
        <Link href={dated("/hire")} className="flex items-center gap-2.5">
          <Image src="/brand/ff-mark-white.png" alt="Fire & Fragrance" width={22} height={22} style={{ height: 22, width: "auto" }} priority />
          <span className="hire-display pt-[3px] text-[22px] tracking-[0.08em] !text-[color:var(--hire-accent)]">HIRE</span>
        </Link>
        <Link
          href={dated("/hire/c/all")}
          aria-label="Search the store"
          className="ml-auto flex h-11 w-11 items-center justify-center !text-[color:var(--hire-ink)]"
        >
          <Search className="h-5 w-5" />
        </Link>
      </header>
    </>
  );
}

function CartButton() {
  const [cart] = useCart();
  return (
    <Link
      href="/hire/cart"
      className="flex items-center gap-2 rounded-[6px] border border-[color:var(--hire-line-strong)] px-3 py-[7px]"
    >
      Cart
      <span className="rounded-[10px] bg-[color:var(--hire-accent)] px-[7px] py-px text-[12px] font-bold text-[color:var(--hire-on-accent)]">
        {cartCount(cart)}
      </span>
    </Link>
  );
}

export function StoreTabBar() {
  const dated = useDated();
  const pathname = usePathname() ?? "";
  const [cart] = useCart();
  const count = cartCount(cart);
  const cell = "flex min-h-[48px] items-center justify-center text-[12px]";
  const tabs = [
    { label: "Home", href: "/hire", active: pathname === "/hire", ready: true },
    { label: "Browse", href: "/hire/c/all", active: pathname.startsWith("/hire/c/"), ready: true },
    {
      label: count ? `Cart · ${count}` : "Cart",
      href: "/hire/cart",
      active: pathname === "/hire/cart" || pathname === "/hire/checkout",
      ready: true,
    },
    { label: "Rentals", href: "/hire/account", active: pathname === "/hire/account" || pathname.startsWith("/hire/o/"), ready: true },
  ];
  return (
    <nav
      aria-label="Store"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-bg)] pt-1.5 md:hidden"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))" }}
    >
      {tabs.map((t) =>
        t.ready ? (
          <Link
            key={t.label}
            href={t.href === "/hire/cart" || t.href === "/hire/account" ? t.href : dated(t.href)}
            aria-current={t.active ? "page" : undefined}
            className={cn(cell, t.active ? "font-bold !text-[color:var(--hire-accent)]" : "!text-[color:var(--hire-muted)]")}
          >
            {t.label}
          </Link>
        ) : (
          <span key={t.label} aria-disabled="true" title="Coming with checkout" className={cn(cell, "text-[color:var(--hire-dim)]")}>
            {t.label}
          </span>
        )
      )}
    </nav>
  );
}
