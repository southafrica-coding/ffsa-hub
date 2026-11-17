"use client";

/**
 * FFSA Hub — application shell
 * REPLACES src/components/admin-sidebar.tsx
 *
 * Structure (from the redesign, frame 2a):
 *   74px black icon rail   — switches AREA (Operations / Mine / System)
 *   212px bone panel       — the modules inside the active area
 *   white content          — the page
 *
 * The rail/panel split is what makes 13 modules + 6 personal tabs readable.
 * Module data still comes from src/config/modules.ts — unchanged.
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { LogOut, Menu, KeyRound, RefreshCw, Briefcase, User, Settings } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { OrgSwitcherMount } from "@/components/missio/org-switcher-mount";
import {
  ADMIN_MODULES,
  SYSTEM_MODULES,
  PORTAL_TABS,
  getAccessibleModules,
  getVisiblePortalTabs,
} from "@/config/modules";

type AreaId = "operations" | "personal" | "system";

const AREAS: { id: AreaId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "operations", label: "Operations", icon: Briefcase },
  { id: "personal", label: "Mine", icon: User },
  { id: "system", label: "System", icon: Settings },
];

interface AdminSidebarProps {
  userRoles: string[];
  permittedModules?: Set<string>;
  menuLoadFailed?: boolean;
  /** Signed-in user's initials, shown on the rail avatar. */
  initials?: string;
}

/* ── 74px black rail ── */
function SignOutForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form action="/auth/sign-out" method="post">
      <button type="submit" title="Sign out" className={className}>
        {children}
      </button>
    </form>
  );
}

function Rail({
  area,
  setArea,
  initials,
}: {
  area: AreaId;
  setArea: (a: AreaId) => void;
  initials: string;
}) {
  return (
    <div className="hidden md:flex w-[74px] shrink-0 flex-col items-center bg-ink py-[18px] gap-1.5">
      <OrgSwitcherMount compact />
      <Link href="/dashboard" className="mb-3.5 block">
        <Image src="/brand/ff-mark-white.png" alt="Fire & Fragrance" width={34} height={34}
               style={{ objectFit: "contain" }} priority />
      </Link>

      {AREAS.map((a) => {
        const active = a.id === area;
        return (
          <button
            key={a.id}
            onClick={() => setArea(a.id)}
            title={a.label}
            className={cn(
              "flex h-[42px] w-[42px] items-center justify-center transition-colors",
              active ? "bg-yellow" : "hover:bg-[#1C1C1A]"
            )}
          >
            <a.icon className={cn("h-[19px] w-[19px]", active ? "text-ink" : "text-[#8E8A7C]")} />
          </button>
        );
      })}

      <div className="flex-1" />

      <Link href="/profile"
            className="flex h-[34px] w-[34px] items-center justify-center bg-bone-2 font-display text-[13px] font-black text-ink">
        {initials}
      </Link>
      <SignOutForm className="mt-2 flex h-[34px] w-[34px] items-center justify-center hover:bg-[#1C1C1A]">
        <LogOut className="h-[17px] w-[17px] text-[#8E8A7C]" />
      </SignOutForm>
    </div>
  );
}

/* ── 212px bone module panel ── */
function ModulePanel({
  area,
  modules,
  pathname,
  onNavClick,
  menuLoadFailed,
  onRefresh,
  inDrawer = false,
  initials,
}: {
  area: AreaId;
  modules: { id: string; label: string; href: string; icon: React.ComponentType<{ className?: string }> }[];
  pathname: string;
  onNavClick?: () => void;
  menuLoadFailed?: boolean;
  onRefresh?: () => void;
  /** In the phone drawer the panel is the whole sheet, not a 212px column. */
  inDrawer?: boolean;
  initials?: string;
}) {
  const title = AREAS.find((a) => a.id === area)?.label ?? "";

  return (
    <aside
      data-shell-panel
      className={cn(
        "flex flex-col bg-bone",
        inDrawer ? "min-h-0 flex-1" : "w-[212px] shrink-0 border-r border-ink"
      )}
    >
      <div className="border-b border-ink px-[18px] pb-4 pt-5">
        <div className="font-display text-[22px] font-black uppercase leading-none text-ink">{title}</div>
        <div className="mono-label mt-1">FFSA Hub · Potch</div>
      </div>

      {menuLoadFailed && onRefresh && (
        <div className="mx-2.5 mt-2.5 border border-amber-border bg-yellow-dim px-3 py-2.5">
          <p className="text-xs leading-snug text-[#45423B]">
            We couldn&apos;t load your menu just now — usually a momentary hiccup, not a change to your access.
          </p>
          <button onClick={onRefresh} className="mono-label mt-2 inline-flex items-center gap-1.5 !text-ink">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto p-2.5">
        {modules.length === 0 && (
          <p className="px-2.5 py-3 text-[13px] leading-snug text-[color:var(--text-secondary)]">
            Nothing in {title.toLowerCase()} for your access yet.
          </p>
        )}
        {modules.map((mod) => {
          const active = pathname === mod.href || pathname.startsWith(mod.href + "/");
          return (
            <Link
              key={mod.id}
              href={mod.href}
              onClick={onNavClick}
              data-active={active ? "" : undefined}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-semibold transition-colors",
                active ? "bg-ink text-white" : "text-[#2A2822] hover:bg-bone-3"
              )}
            >
              <mod.icon className="h-[15px] w-[15px] shrink-0" />
              <span>{mod.label}</span>
            </Link>
          );
        })}
      </nav>

      {area === "personal" && (
        <Link href="/account/security" onClick={onNavClick}
              className="flex items-center gap-2.5 border-t border-ink px-[18px] py-3 text-[13px] font-semibold text-[#2A2822] hover:bg-bone-3">
          <KeyRound className="h-[15px] w-[15px]" /> Change password
        </Link>
      )}

      {inDrawer && (
        <div className="mt-auto border-t border-ink">
          <Link
            href="/profile"
            onClick={onNavClick}
            className="flex items-center gap-2.5 px-[18px] py-3 text-[13px] font-semibold text-[#2A2822] hover:bg-bone-3"
          >
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center bg-ink font-display text-[11px] font-black text-white">
              {initials || "\u00B7"}
            </span>
            My profile
          </Link>
          <SignOutForm className="flex w-full items-center gap-2.5 border-t border-rule px-[18px] py-3.5 text-[13px] font-semibold text-[#2A2822] hover:bg-bone-3">
            <LogOut className="h-[15px] w-[15px]" /> Sign out
          </SignOutForm>
        </div>
      )}
    </aside>
  );
}

export function AdminSidebar({ userRoles, permittedModules, menuLoadFailed, initials }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleModules = getAccessibleModules(ADMIN_MODULES, userRoles, permittedModules);
  const visibleSystem = getAccessibleModules(SYSTEM_MODULES, userRoles, permittedModules);

  // Area follows the URL so a deep link lands on the right panel.
  const initialArea: AreaId =
    visibleSystem.some((m) => pathname.startsWith(m.href)) ? "system"
    : PORTAL_TABS.some((t) => pathname.startsWith(t.href)) || pathname.startsWith("/account") ? "personal"
    : "operations";
  const [area, setArea] = useState<AreaId>(initialArea);

  const modules =
    area === "operations" ? visibleModules
    : area === "system" ? visibleSystem
    : getVisiblePortalTabs().map((t) => ({ ...t, icon: t.icon }));

  return (
    <>
      <Rail area={area} setArea={setArea} initials={initials || "·"} />
      <div className="hidden md:flex">
        <ModulePanel
          area={area}
          modules={modules}
          pathname={pathname}
          menuLoadFailed={menuLoadFailed}
          onRefresh={() => router.refresh()}
        />
      </div>

      {/* ── Mobile: black top bar + drawer ── */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between bg-ink px-4 md:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <OrgSwitcherMount compact />
          <Image src="/brand/ff-wordmark-white.png" alt="Fire & Fragrance" width={120} height={14}
                 style={{ objectFit: "contain" }} priority />
        </span>
        <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="flex h-11 w-11 items-center justify-center text-white">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" data-shell-panel className="w-[280px] border-r border-ink bg-bone p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            {/* pr-14 keeps System clear of the sheet's close button. */}
            <div className="flex gap-1 bg-ink p-2 pr-14">
              {AREAS.map((a) => (
                <button key={a.id} onClick={() => setArea(a.id)}
                  className={cn(
                    "flex-1 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]",
                    a.id === area ? "bg-yellow text-ink" : "text-[#8E8A7C]"
                  )}>
                  {a.label}
                </button>
              ))}
            </div>
            <ModulePanel
              area={area}
              modules={modules}
              pathname={pathname}
              onNavClick={() => setMobileOpen(false)}
              menuLoadFailed={menuLoadFailed}
              onRefresh={() => router.refresh()}
              inDrawer
              initials={initials}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
