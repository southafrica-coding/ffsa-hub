"use client";

/**
 * FFSA Hub — mobile bottom tab bar (frame 4d)
 *
 * "Where students and volunteers actually live." On a phone the 74px rail +
 * 212px panel of frame 2a cannot apply, and a hamburger drawer hides the
 * four things this audience opens every day behind a tap. So the phone gets
 * its own primary navigation: four fixed tabs, thumb-reachable.
 *
 * Rules the frame encodes, and this component enforces:
 *   · exactly FOUR items — a fifth makes each target too narrow to hit
 *   · 48px minimum hit target
 *   · the active tab is the only yellow thing on screen
 *   · square, flat, no rounding — same system as everywhere else
 *
 * The hamburger drawer stays for everything else (Operations, System).
 * This bar is the shortcut to the four personal destinations, not a
 * replacement for the full menu.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { GraduationCap, Wallet, Heart, User } from "lucide-react";

/**
 * Four, and only four. Each is open to every signed-in account — the
 * personal tabs are not permission-gated, and the prayer room is part of
 * the baseline access floor — so this bar never renders a dead link.
 */
const TABS = [
  { id: "school", label: "School", href: "/my-schools", icon: GraduationCap },
  { id: "finance", label: "Finance", href: "/my-finance", icon: Wallet },
  { id: "prayer", label: "Prayer", href: "/prayer-room", icon: Heart },
  { id: "me", label: "Me", href: "/profile", icon: User },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      data-shell-tabbar
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-ink bg-ink md:hidden"
      // The iOS home indicator sits over the bar's bottom edge; without this
      // the labels are half-covered on every notched phone.
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {TABS.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[48px] flex-col items-center justify-center gap-1.5 px-1 pb-3 pt-3",
              active && "bg-[#1C1C1A]"
            )}
          >
            <tab.icon
              className={cn("h-5 w-5", active ? "text-yellow" : "text-[#8E8A7C]")}
            />
            <span
              className={cn(
                "font-mono text-[8px] font-bold uppercase tracking-[0.1em]",
                active ? "text-yellow" : "text-[#8E8A7C]"
              )}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
