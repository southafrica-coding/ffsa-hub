"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, GraduationCap, Heart, LayoutDashboard, LayoutGrid, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { id: "home", label: "Home", href: "/home", icon: LayoutDashboard },
  { id: "services", label: "Services", href: "/services", icon: LayoutGrid },
  { id: "departments", label: "Departments", href: "/departments", icon: Building2 },
  { id: "me", label: "Me", href: "/profile", icon: User },
] as const;

const PORTAL_TABS = [
  { id: "school", label: "School", href: "/my-schools", icon: GraduationCap },
  { id: "finance", label: "Finance", href: "/my-finance", icon: Wallet },
  { id: "prayer", label: "Prayer", href: "/prayer-room", icon: Heart },
  { id: "me", label: "Me", href: "/profile", icon: User },
] as const;

export function MobileTabBar({
  showDepartments = false,
  variant = "staff",
}: {
  showDepartments?: boolean;
  variant?: "staff" | "portal";
}) {
  const pathname = usePathname();
  const tabs = variant === "portal"
    ? PORTAL_TABS
    : TABS.filter((tab) => tab.id !== "departments" || showDepartments);

  return (
    <nav
      aria-label="Primary"
      data-shell-tabbar
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 grid border-t border-white/15 bg-brand-black md:hidden",
        tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {tabs.map((tab) => {
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
