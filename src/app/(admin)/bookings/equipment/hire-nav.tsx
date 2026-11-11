"use client";

// The hire module's own navigation (frames 47c and 47e).
//   Desktop: a dark "Hire" side panel beside the content.
//   Phone (< 768px): no side panel; a bottom tab bar instead —
//   Today · Scan · Orders · Gear · More — with 44px+ targets.
// Screens that haven't been built yet are shown but can't be opened, so
// the shape of the module is visible without any dead links.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type NavItem = { label: string; href: string; ready: boolean };

const BASE = "/bookings/equipment";

const PANEL: NavItem[] = [
  { label: "Dashboard", href: BASE, ready: false },
  { label: "Orders", href: `${BASE}/orders`, ready: false },
  { label: "Calendar", href: `${BASE}/calendar`, ready: false },
  { label: "Register", href: `${BASE}/gear`, ready: true },
  { label: "Maintenance", href: `${BASE}/maintenance`, ready: false },
  { label: "Storefront", href: "/hire", ready: true },
  { label: "Pricing", href: `${BASE}/pricing`, ready: true },
];

function isActive(pathname: string, href: string) {
  if (href === BASE) return pathname === BASE;
  return pathname === href || pathname.startsWith(href + "/");
}

export function HirePanel() {
  const pathname = usePathname() ?? "";
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] py-6 md:flex">
      <Link
        href="/bookings"
        className="mb-3 flex items-center gap-1.5 px-5 text-[12px] text-[color:var(--hire-muted)] hover:text-[color:var(--hire-ink)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Bookings
      </Link>
      <div className="hire-display px-5 pb-3 text-[26px] !text-[color:var(--hire-accent)]">Hire</div>
      <nav className="flex flex-col gap-px">
        {PANEL.map((item) => {
          const active = isActive(pathname, item.href);
          if (!item.ready) {
            return (
              <span
                key={item.label}
                title="Not built yet"
                className="flex items-center justify-between px-5 py-[9px] text-[14px] text-[color:var(--hire-dim)]"
              >
                {item.label}
                <span className="text-[10px] uppercase tracking-[0.14em]">Soon</span>
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-5 py-[9px] text-[14px]",
                active
                  ? "bg-[color:var(--hire-hover)] font-bold text-[color:var(--hire-ink)] shadow-[inset_3px_0_0_var(--hire-accent)]"
                  : "text-[color:var(--hire-body)] hover:bg-[color:var(--hire-hover)]"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

const TABS: (NavItem & { scan?: boolean })[] = [
  { label: "Today", href: `${BASE}/today`, ready: false },
  { label: "Scan", href: `${BASE}/scan`, ready: false, scan: true },
  { label: "Orders", href: `${BASE}/orders`, ready: false },
  { label: "Gear", href: `${BASE}/gear`, ready: true },
];

export function HireTabBar() {
  const pathname = usePathname() ?? "";
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setMoreOpen(false), [pathname]);

  // Portalled to <body>: the admin layout animates its content with a
  // transform, which would pin a fixed bar to the page instead of the screen.
  if (!mounted) return null;

  const cell = "flex min-h-[48px] items-center justify-center text-[12px]";

  return createPortal(
    <div className="theme-hire md:hidden">
      <nav
        aria-label="Hire"
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-bg)] px-1 pt-2"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))" }}
      >
        {TABS.map((tab) => {
          const active = tab.ready && isActive(pathname, tab.href);
          if (tab.scan) {
            const circle = (
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-[999px] bg-[color:var(--hire-accent)] text-[12px] font-bold text-[color:var(--hire-on-accent)]",
                  !tab.ready && "opacity-40"
                )}
              >
                Scan
              </span>
            );
            return tab.ready ? (
              <Link key={tab.label} href={tab.href} className={cell}>
                {circle}
              </Link>
            ) : (
              <span key={tab.label} title="Not built yet" className={cell}>
                {circle}
              </span>
            );
          }
          return tab.ready ? (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                cell,
                active ? "font-bold text-[color:var(--hire-accent)]" : "text-[color:var(--hire-muted)]"
              )}
            >
              {tab.label}
            </Link>
          ) : (
            <span
              key={tab.label}
              title="Not built yet"
              className={cn(cell, "text-[color:var(--hire-dim)]")}
            >
              {tab.label}
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(cell, moreOpen ? "font-bold text-[color:var(--hire-accent)]" : "text-[color:var(--hire-muted)]")}
        >
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60" onClick={() => setMoreOpen(false)}>
          <div
            className="rounded-t-[16px] border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] pb-[max(16px,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-[18px] pb-2 pt-4">
              <span className="hire-display text-[32px]">More</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center text-[color:var(--hire-muted)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {PANEL.filter((i) => !["Orders", "Register"].includes(i.label)).map((item) =>
              item.ready ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex min-h-[52px] items-center border-t border-[color:var(--hire-line)] px-[18px] text-[15px] text-[color:var(--hire-ink)]"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  className="flex min-h-[52px] items-center justify-between border-t border-[color:var(--hire-line)] px-[18px] text-[15px] text-[color:var(--hire-dim)]"
                >
                  {item.label}
                  <span className="text-[11px] uppercase tracking-[0.14em]">Soon</span>
                </span>
              )
            )}
            <Link
              href="/bookings"
              className="flex min-h-[52px] items-center gap-2 border-t border-[color:var(--hire-line)] px-[18px] text-[15px] text-[color:var(--hire-body)]"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Bookings
            </Link>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
