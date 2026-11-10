"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronDown, LogOut, Menu, PanelLeft, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/ffsa/logo";
import { buildShellNav, flattenShellNav, type ShellLink, type ShellNav } from "@/components/shell-nav";

interface AdminSidebarProps {
  userRoles: string[];
  permittedModules?: Set<string>;
  menuLoadFailed?: boolean;
  initials?: string;
  /** Review gallery only. Production leaves both unset. */
  defaultCollapsed?: boolean;
  defaultGroupsClosed?: boolean;
  /** One row per department the viewer leads or serves on. Hidden when empty. */
  departments?: { id: string; label: string; href: string }[];
}

function SignOutForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form action="/auth/sign-out" method="post">
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: ShellLink;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      data-active={active ? "" : undefined}
      title={item.label}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-ui text-[color:var(--bone)] hover:bg-white/10 hover:text-bg",
        active && "bg-yellow font-medium text-brand-black hover:bg-yellow hover:text-brand-black",
        collapsed && "justify-center px-0"
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
    </Link>
  );
}

function Group({
  id,
  label,
  items,
  pathname,
  collapsed,
  open,
  onToggle,
  onNavigate,
}: {
  id: string;
  label: string;
  items: ShellLink[];
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        className={cn(
          "flex h-8 w-full items-center justify-between px-2 text-left text-[12px] font-medium text-[color:var(--bone)]",
          collapsed && "sr-only"
        )}
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {(open || collapsed) && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink
              key={item.id}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      <span className="sr-only">{id}</span>
    </div>
  );
}

function CommandMenu({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: ShellLink[];
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  if (!open) return null;
  const shown = items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-brand-black/40 px-4 pt-[15vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Jump to a page"
        className="w-full max-w-md rounded-lg border border-border bg-bg p-2 text-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a page"
          className="h-9 w-full rounded-md border border-rule-strong bg-bg px-3 text-ui"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        />
        <ul className="mt-2 max-h-80 overflow-y-auto">
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                onClick={onClose}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-ui text-ink hover:bg-bg-subtle"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-3 text-ui text-[color:var(--text-secondary)]">Nothing matches.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function SidebarBody({
  nav,
  pathname,
  collapsed,
  groupsOpen,
  toggleGroup,
  onNavigate,
  menuLoadFailed,
  onRefresh,
  initials,
  onSearch,
}: {
  nav: ShellNav;
  pathname: string;
  collapsed: boolean;
  groupsOpen: Record<string, boolean>;
  toggleGroup: (id: string) => void;
  onNavigate?: () => void;
  menuLoadFailed?: boolean;
  onRefresh?: () => void;
  initials: string;
  onSearch: () => void;
}) {
  const [meOpen, setMeOpen] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex items-center", collapsed ? "flex-col gap-1 px-1 pt-2" : "gap-1 pr-2")}>
        <Link href="/dashboard" aria-label="FFSA Hub" onClick={onNavigate} className="shrink-0">
          <Logo surface="black" kind="mark" height={24} />
        </Link>
        {!collapsed ? <span className="text-ui font-medium text-bg">FFSA Hub</span> : null}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className={cn(
          "mx-2 mt-1 flex h-8 items-center gap-2 rounded-md px-2 text-ui text-[color:var(--bone)] hover:bg-white/10",
          collapsed && "justify-center px-0"
        )}
        aria-label="Search pages"
      >
        <Search className="h-4 w-4" aria-hidden />
        {collapsed ? null : (
          <>
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[12px]">⌘K</kbd>
          </>
        )}
      </button>

      {menuLoadFailed && onRefresh ? (
        <div className="mx-2 mt-2 rounded-md border border-warning px-2 py-2">
          <p className="text-ui leading-snug text-[color:var(--bone)]">
            We couldn&apos;t load your menu just now.
          </p>
          <button type="button" onClick={onRefresh} className="mt-1 text-ui text-bg">
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
            Refresh
          </button>
        </div>
      ) : null}

      <nav aria-label="Primary" className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
        {nav.home ? <NavLink item={nav.home} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} /> : null}
        {nav.inbox ? <NavLink item={nav.inbox} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} /> : null}
        <Group id="services" label="Services" items={nav.services} pathname={pathname} collapsed={collapsed} open={groupsOpen.services !== false} onToggle={() => toggleGroup("services")} onNavigate={onNavigate} />
        <Group id="departments" label="My departments" items={nav.departments} pathname={pathname} collapsed={collapsed} open={groupsOpen.departments !== false} onToggle={() => toggleGroup("departments")} onNavigate={onNavigate} />
        <Group id="work" label="Work tools" items={nav.work} pathname={pathname} collapsed={collapsed} open={groupsOpen.work !== false} onToggle={() => toggleGroup("work")} onNavigate={onNavigate} />
        <Group id="system" label="System" items={nav.system} pathname={pathname} collapsed={collapsed} open={groupsOpen.system !== false} onToggle={() => toggleGroup("system")} onNavigate={onNavigate} />
      </nav>

      <div className="relative border-t border-white/15 p-2">
        <button
          type="button"
          className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-ui text-bg hover:bg-white/10", collapsed && "justify-center px-0")}
          aria-expanded={meOpen}
          aria-label="Account menu"
          onClick={() => setMeOpen((open) => !open)}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-bg text-[12px] font-medium text-brand-black">
            {initials || "·"}
          </span>
          {collapsed ? null : <span>Me</span>}
        </button>
        {meOpen ? (
          <div
            className="absolute bottom-12 left-2 z-10 w-52 rounded-lg border border-border p-1 shadow-none"
            style={{ background: "var(--bg)", color: "var(--text)" }}
          >
            {nav.me.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => {
                  setMeOpen(false);
                  onNavigate?.();
                }}
                className="flex h-8 items-center rounded-md px-2 text-ui hover:bg-bg-subtle"
              >
                {item.label}
              </Link>
            ))}
            <SignOutForm className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui hover:bg-bg-subtle">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </SignOutForm>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AdminSidebar({
  userRoles,
  permittedModules,
  menuLoadFailed,
  initials,
  defaultCollapsed = false,
  defaultGroupsClosed = false,
  departments,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useMemo(
    () =>
      buildShellNav(
        userRoles,
        permittedModules,
        (departments ?? []).map((department) => ({ ...department, icon: Building2 }))
      ),
    [userRoles, permittedModules, departments]
  );
  const items = useMemo(() => flattenShellNav(nav), [nav]);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(
    defaultGroupsClosed
      ? { services: false, departments: false, work: false, system: false }
      : {}
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleGroup(id: string) {
    setGroupsOpen((current) => {
      return { ...current, [id]: current[id] === false };
    });
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      document.cookie = `ffsa-sidebar=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  const bodyProps = {
    nav,
    pathname,
    groupsOpen,
    toggleGroup,
    menuLoadFailed,
    onRefresh: () => router.refresh(),
    initials: initials || "·",
    onSearch: () => setSearchOpen(true),
  };

  return (
    <>
      <aside
        data-shell-panel
        data-shell-sidebar
        className={cn(
          "hidden h-screen shrink-0 flex-col bg-brand-black text-bg transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <SidebarBody {...bodyProps} collapsed={collapsed} />
        <div className="border-t border-white/15 p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-full items-center justify-center rounded-md text-[color:var(--bone)] hover:bg-white/10"
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between bg-brand-black px-2 md:hidden">
        <Logo surface="black" kind="wordmark" height={24} />
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="flex h-11 w-11 items-center justify-center text-bg">
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" data-shell-panel data-shell-sidebar className="w-[280px] border-r border-brand-black bg-brand-black p-0 text-bg">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody {...bodyProps} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <CommandMenu open={searchOpen} onClose={() => setSearchOpen(false)} items={items} />
    </>
  );
}
