"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, LayoutGrid, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { id: "home", label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { id: "services", label: "Services", href: "/services", icon: LayoutGrid },
  { id: "departments", label: "Departments", href: "/departments", icon: Building2 },
  { id: "me", label: "Me", href: "/profile", icon: User },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      data-shell-tabbar
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-white/15 bg-brand-black md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            aria-label={tab.label}
            className="flex min-h-12 flex-col items-center justify-center gap-1 px-1 py-2"
          >
            <span className={cn("h-0.5 w-6", active ? "bg-yellow" : "bg-transparent")} aria-hidden />
            <tab.icon
              className={cn("h-5 w-5", active ? "text-bg" : "text-[color:var(--bone)]")}
              aria-hidden
            />
            <span className={cn("text-[12px] leading-4", active ? "text-bg" : "text-[color:var(--bone)]")}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
