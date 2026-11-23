"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Calendar, CalendarDays, Heart, House, Mail, MessageCircle, Settings, Sprout, Sunrise, UserCheck, Users, UsersRound, Wallet } from "lucide-react";
import { canAccessMissio, canSeeMissioCare, isMissioPastor, missioSkinVars, orgHref, sortOrgs } from "./access";
import { MissioViewerProvider } from "./viewer";
import { MissioApiError, missioClient, type MissioClient } from "./api";
import { loadFfsaRoleNames } from "./ffsa-roles";
import { missioCrumbLabel } from "./crumb";
import { BACK_TO_FFSA_HUB, missioOrgHeader, needsPlatformRoleLookup, type OrgHeaderState } from "./org-header";
import { OrgSwitcher, OrgTile } from "./org-switcher";
import type { OrgSwitcherOrg } from "./use-org-switcher";
import type { MissioMe } from "./types-shim";
import styles from "./shell.module.css";

export function missioSection(pathname: string): "home" | "people" | "houses" | "follow" | "sundays" {
  if (pathname.includes("/missio/people")) return "people";
  if (pathname.includes("/missio/sundays")) return "sundays";
  if (pathname.includes("/missio/house-churches")) return "houses";
  if (pathname.includes("/missio/follow-up")) return "follow";
  return "home";
}

type Gate =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "no-access"; status: 401 | 403 }
  | { kind: "ready"; me: MissioMe; ffsaRoleNames: string[] | null };

const skinStyle = missioSkinVars() as CSSProperties;

export function MissioFrame({
  children,
  client = missioClient,
  loadFfsaRoles = loadFfsaRoleNames,
}: {
  children: React.ReactNode;
  client?: MissioClient;
  /** Platform roles from GET /api/me. Null when that read failed. */
  loadFfsaRoles?: () => Promise<readonly string[] | null>;
}) {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const meResult = client.getMe().then(
      (me) => ({ ok: true as const, me }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const rolesResult = loadFfsaRoles().catch(() => null);

    Promise.all([meResult, rolesResult]).then(([meOutcome, ffsaRoleNames]) => {
      if (!active) return;
      if (!meOutcome.ok) {
        const code = meOutcome.error instanceof MissioApiError ? meOutcome.error.code : null;
        if (code === "unauthenticated") setGate({ kind: "no-access", status: 401 });
        else if (code === "forbidden") setGate({ kind: "no-access", status: 403 });
        else setGate({ kind: "error" });
        return;
      }
      if (!canAccessMissio(meOutcome.me)) {
        setGate({ kind: "no-access", status: 403 });
        return;
      }
      const roles = needsPlatformRoleLookup(meOutcome.me.orgs)
        ? ffsaRoleNames
          ? [...ffsaRoleNames]
          : null
        : [];
      setGate({ kind: "ready", me: meOutcome.me, ffsaRoleNames: roles });
    });

    return () => {
      active = false;
    };
  }, [client, loadFfsaRoles, attempt]);

  if (gate.kind === "loading") {
    return (
      <div data-missio-shell="" data-skin="missio" data-access="loading" className={styles.denied} style={skinStyle}>
        <p>Loading Missio…</p>
      </div>
    );
  }

  if (gate.kind === "error") {
    return (
      <div data-missio-shell="" data-skin="missio" data-access="error" className={styles.denied} style={skinStyle}>
        <div className={styles.deniedCard}>
          <h1>Missio didn’t load</h1>
          <p>The church workspace didn’t respond. This isn’t an access decision.</p>
          <button type="button" className={styles.primary} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
          <Link href="/dashboard" className={styles.back} data-org-header="back">
            {BACK_TO_FFSA_HUB}
          </Link>
        </div>
      </div>
    );
  }

  if (gate.kind === "no-access") {
    return (
      <div data-missio-shell="" data-skin="missio" data-access="denied" className={styles.denied} style={skinStyle}>
        <NoAccess status={gate.status} />
      </div>
    );
  }

  return (
    <MissioReady me={gate.me} ffsaRoleNames={gate.ffsaRoleNames}>
      {children}
    </MissioReady>
  );
}

function MissioReady({
  me,
  ffsaRoleNames,
  children,
}: {
  me: MissioMe;
  ffsaRoleNames: string[] | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (query.matches) setNavOpen(false);
    };
    closeOnDesktop();
    if (typeof query.addEventListener !== "function") return;
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet open={navOpen} onOpenChange={setNavOpen}>
      <div data-missio-shell="" data-skin="missio" data-access="ready" className={styles.shell} style={skinStyle}>
        <div className={styles.sideSlot}>
          <MissioSidebar me={me} ffsaRoleNames={ffsaRoleNames} />
        </div>
        <div className={styles.main}>
          <MissioTop me={me} navOpen={navOpen} />
          <div className={styles.content} data-missio-content="">
            <MissioViewerProvider me={me}>{children}</MissioViewerProvider>
          </div>
          <MissioTabBar me={me} />
        </div>
      </div>
      <SheetContent side="left" id="missio-nav" className={`theme-light ${styles.drawer}`} style={skinStyle}>
        <SheetTitle className={styles.visuallyHidden}>Missio navigation</SheetTitle>
        <SheetDescription className={styles.visuallyHidden}>Sections in this church</SheetDescription>
        <MissioSidebar me={me} ffsaRoleNames={ffsaRoleNames} inDrawer onNavigate={() => setNavOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function MissioSidebar({
  me,
  ffsaRoleNames,
  inDrawer = false,
  onNavigate,
}: {
  me: MissioMe;
  ffsaRoleNames: string[] | null;
  inDrawer?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const header = missioOrgHeader({ orgs: me.orgs, ffsaRoleNames });
  const missio = me.orgs.find((org) => org.slug === "missio");
  const section = missioSection(pathname);
  const home = section === "home" && (pathname === "/missio" || pathname.endsWith("/missio"));
  const pastor = isMissioPastor(me);
  const showCare = canSeeMissioCare(me);

  // Board M11a menu: Home · People · House churches · Follow-up · Care · Sundays ·
  // Volunteers, then the modules that aren't built yet under "Later".
  // Next leaders has no other way in, so it stays beside House churches.
  const items: Array<{ key: string; href: string; label: string; on: boolean; icon: ReactNode; show: boolean }> = [
    { key: "home", href: "/missio", label: "Home", on: home, icon: <Sunrise />, show: true },
    { key: "people", href: "/missio/people", label: "People", on: section === "people", icon: <Users />, show: pastor },
    {
      key: "house-churches",
      href: "/missio/house-churches",
      label: housesNavLabel(me),
      on: section === "houses",
      icon: <House />,
      show: true,
    },
    {
      key: "next-leaders",
      href: "/missio/next-leaders",
      label: "Next leaders",
      on: pathname.startsWith("/missio/next-leaders"),
      icon: <Sprout />,
      show: true,
    },
    { key: "follow-up", href: "/missio/follow-up", label: "Follow-up", on: section === "follow", icon: <UserCheck />, show: pastor },
    { key: "care", href: "/missio/care", label: "Care", on: pathname.startsWith("/missio/care"), icon: <Heart />, show: showCare },
    { key: "sundays", href: "/missio/sundays", label: "Sundays", on: section === "sundays", icon: <Calendar />, show: true },
    // Pastors only, and in the menu only: a sixth phone tab would crowd the M11a set.
    {
      key: "calendar",
      href: "/missio/calendar",
      label: "Calendar",
      on: pathname.startsWith("/missio/calendar"),
      icon: <CalendarDays />,
      show: pastor,
    },
    {
      key: "volunteers",
      href: "/missio/volunteers",
      label: "Volunteers",
      on: pathname.startsWith("/missio/volunteers") || pathname.startsWith("/serve/missio/preview/pastor"),
      icon: <UsersRound />,
      show: pastor,
    },
    // Pastors only. Not a phone tab: the M11a bar keeps its five, so Finance
    // lives in this menu on phones.
    { key: "finance", href: "/missio/finance", label: "Finance", on: pathname.startsWith("/missio/finance"), icon: <Wallet />, show: pastor },
    // Pastors only, menu only (no sixth phone tab): messages from Missio's WhatsApp number.
    { key: "whatsapp", href: "/missio/whatsapp", label: "WhatsApp", on: pathname.startsWith("/missio/whatsapp"), icon: <MessageCircle />, show: pastor },
  ];

  return (
    <aside className={`${styles.side} ${inDrawer ? styles.sideDrawer : ""}`}>
      {inDrawer ? (
        <div className={styles.drawerHead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
          <img src="/brands/missio/missio-wordmark-paper.png" alt="Missio" className={styles.wordmark} />
        </div>
      ) : null}
      {inDrawer && header.kind === "switcher" ? (
        <OrgSegmented orgs={header.orgs} />
      ) : (
        <div className={inDrawer ? styles.drawerOrg : styles.sideOrg}>
          <OrgHeader state={header} />
        </div>
      )}
      <nav className={styles.nav} aria-label="Missio">
        {items
          .filter((item) => item.show)
          .map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`${styles.navLink} ${item.on ? styles.navOn : ""}`}
              aria-current={item.on ? "page" : undefined}
              data-testid={item.key === "home" ? undefined : `missio-nav-${item.key}`}
              onClick={onNavigate}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        <div className={styles.sgroup}>Later</div>
        {[
          { key: "teams", label: "Teams", icon: <UsersRound /> },
          { key: "communications", label: "Communications", icon: <Mail /> },
        ].map((item) => (
          <div key={item.key} className={styles.soon} aria-disabled="true" data-testid={`missio-soon-${item.key}`}>
            {item.icon}
            <span>{item.label}</span>
            <span className={styles.soonTag}>Soon</span>
          </div>
        ))}
      </nav>
      <div className={styles.foot}>
        <div className={styles.soon} aria-disabled="true" data-testid="missio-soon-settings">
          <Settings />
          <span>Settings</span>
          <span className={styles.soonTag}>Soon</span>
        </div>
        <div className={styles.me}>
          <span className={styles.avatar}>M</span>
          <div>
            <div className={styles.who}>{roleLabel(me.rolesByOrg.missio ?? [])}</div>
            <div className={styles.role}>{missio?.name ?? "Missio"}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Phone menu (boards M1c, M11a): the two orgs side by side, the current one lifted. */
function OrgSegmented({ orgs }: { orgs: OrgSwitcherOrg[] }) {
  const ordered = sortOrgs(orgs);
  return (
    <div className={styles.orgSeg} role="group" aria-label="Organisations" data-org-switcher="segmented">
      {ordered.map((org) => {
        const current = org.slug === "missio";
        const label = org.slug === "ffsa" ? "FFSA" : org.slug === "missio" ? "Missio" : org.name;
        return current ? (
          <span key={org.id} className={`${styles.orgSegItem} ${styles.orgSegOn}`} aria-current="true" title={org.name}>
            <OrgTile slug={org.slug} />
            {label}
          </span>
        ) : (
          <a key={org.id} href={org.href || orgHref(org.slug)} className={styles.orgSegItem} title={org.name}>
            {label}
          </a>
        );
      })}
    </div>
  );
}

/**
 * Phone only (CSS hides it from 768px). Board M11a: Home · People · Houses ·
 * Sundays · Follow-up for pastors. The drawer keeps the org switcher and the rest.
 */
function MissioTabBar({ me }: { me: MissioMe }) {
  const pathname = usePathname();
  const section = missioSection(pathname);
  const pastor = isMissioPastor(me);
  const homeTab = {
    key: "home",
    href: "/missio",
    label: "Home",
    // Only Home itself. Pages without a tab (Care for pastors, Next leaders,
    // Volunteers) leave every tab unlit rather than pretending to be Home.
    on: pathname === "/missio" || pathname === "/missio/",
    icon: <Sunrise />,
  };
  const sundays = { key: "sundays", href: "/missio/sundays", label: "Sundays", on: section === "sundays", icon: <Calendar /> };
  const tabs: Array<{ key: string; href: string; label: string; on: boolean; icon: ReactNode }> = [homeTab];
  if (pastor) {
    tabs.push(
      { key: "people", href: "/missio/people", label: "People", on: section === "people", icon: <Users /> },
      { key: "house-churches", href: "/missio/house-churches", label: "Houses", on: section === "houses", icon: <House /> },
      sundays,
      { key: "follow-up", href: "/missio/follow-up", label: "Follow-up", on: section === "follow", icon: <UserCheck /> }
    );
  } else {
    tabs.push({
      key: "house-churches",
      href: "/missio/house-churches",
      label: housesNavLabel(me) === "My house" ? "My house" : "My houses",
      on: section === "houses",
      icon: <House />,
    });
    // Leaders see what their house shared with them (migration 354). Same
    // role list as GET /api/missio/care, so nobody gets a tab the API refuses.
    if (canSeeMissioCare(me)) {
      tabs.push({ key: "care", href: "/missio/care", label: "Care", on: pathname.startsWith("/missio/care"), icon: <Heart /> });
    }
    tabs.push(sundays);
  }
  return (
    <nav className={styles.tabBar} aria-label="Missio sections" data-testid="missio-tab-bar">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`${styles.tab} ${tab.on ? styles.tabOn : ""}`}
          aria-current={tab.on ? "page" : undefined}
          data-testid={`missio-tab-${tab.key}`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function OrgHeader({ state }: { state: OrgHeaderState }) {
  if (state.kind === "switcher") {
    return <OrgSwitcher orgs={state.orgs} currentOrg="missio" sub="Switch org" />;
  }
  if (state.kind === "back") {
    return (
      <Link href="/dashboard" className={styles.orgBack} data-org-header="back">
        {BACK_TO_FFSA_HUB}
      </Link>
    );
  }
  return (
    <div className={styles.orgStatic} data-org-header="static">
      <OrgTile slug="missio" />
      <span>{state.name}</span>
    </div>
  );
}

function MissioTop({ me, navOpen }: { me: MissioMe; navOpen: boolean }) {
  const pathname = usePathname();
  const section = missioCrumbLabel(pathname);
  const orgName = me.orgs.find((org) => org.slug === "missio")?.name ?? "Missio";
  // Phone top bar (board M11a): the Missio tile opens the menu, then the page's name.
  return (
    <div className={styles.top}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Open menu"
          aria-expanded={navOpen}
          aria-controls={navOpen ? "missio-nav" : undefined}
        >
          <OrgTile slug="missio" />
        </button>
      </SheetTrigger>
      <span className={styles.crumb}>
        <span className={styles.crumbOrg}>{orgName} / </span>
        <b>{section}</b>
      </span>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  pastor: "Pastor",
  admin: "Admin",
  house_church_leader: "House church leader",
  coach: "Coach",
  team_leader: "Team leader",
  finance: "Finance",
};

/** Leaders who only lead see "My house"; pastors and coaches see "House churches". */
function housesNavLabel(me: MissioMe): string {
  const roles: readonly string[] = me.rolesByOrg.missio ?? [];
  if (roles.includes("pastor") || roles.includes("coach")) return "House churches";
  return roles.includes("house_church_leader") ? "My house" : "House churches";
}

function roleLabel(roles: string[]): string {
  const role = roles.find((item) => item === "pastor") ?? roles.find((item) => item === "coach") ?? roles[0];
  if (!role) return "";
  return ROLE_LABEL[role] ?? role;
}

export function NoAccess({ status }: { status: 401 | 403 }) {
  const signedOut = status === 401;
  return (
    <section className={styles.deniedCard} data-testid="missio-no-access" data-status={status}>
      <OrgTile slug="missio" large />
      <h1>{signedOut ? "Sign in required" : "Pastors only"}</h1>
      <p>
        {signedOut
          ? "You’re not signed in. Missio opens for a pastor of this church."
          : "Missio is open to pastors of this church. An FFSA admin role doesn’t include it, and Missio people stay separate from the rest of the Hub."}
      </p>
      <Link href="/dashboard" className={styles.back}>
        Back to the FFSA Hub
      </Link>
    </section>
  );
}
