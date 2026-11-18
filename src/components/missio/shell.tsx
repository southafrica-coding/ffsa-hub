"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { canAccessMissio, missioSkinVars } from "./access";
import { MissioViewerProvider } from "./viewer";
import { MissioApiError, missioClient, type MissioClient } from "./api";
import { loadFfsaRoleNames } from "./ffsa-roles";
import { BACK_TO_FFSA_HUB, missioOrgHeader, needsPlatformRoleLookup, type OrgHeaderState } from "./org-header";
import { OrgSwitcher, OrgTile } from "./org-switcher";
import type { MissioMe } from "./types-shim";
import styles from "./shell.module.css";

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
          <MissioTop me={me} ffsaRoleNames={ffsaRoleNames} navOpen={navOpen} />
          <div className={styles.content} data-missio-content="">
            <MissioViewerProvider me={me}>{children}</MissioViewerProvider>
          </div>
        </div>
      </div>
      <SheetContent side="left" id="missio-nav" className={styles.drawer} style={skinStyle}>
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
  const home = pathname === "/missio";
  const people = pathname.startsWith("/missio/people");
  const houses = pathname.startsWith("/missio/house-churches");
  const pastor = canAccessMissio(me);

  const orgNode = <OrgHeader state={header} />;

  return (
    <aside className={`${styles.side} ${inDrawer ? styles.sideDrawer : ""}`}>
      {inDrawer ? <div className={styles.drawerOrg}>{orgNode}</div> : orgNode}
      <form className={styles.search} action="/missio/people" onSubmit={() => onNavigate?.()}>
        <SearchIcon />
        <input name="q" placeholder="Search" aria-label="Search Missio" />
      </form>
      <nav className={styles.nav} aria-label="Missio">
        <Link href="/missio" className={`${styles.navLink} ${home ? styles.navOn : ""}`} aria-current={home ? "page" : undefined} onClick={onNavigate}>
          <HomeIcon />
          <span>Home</span>
        </Link>
        <Link href="/missio/people" className={`${styles.navLink} ${people ? styles.navOn : ""}`} aria-current={people ? "page" : undefined} onClick={onNavigate}>
          <PeopleIcon />
          <span>People</span>
        </Link>
        {pastor ? (
          <Link
            href="/missio/house-churches"
            className={`${styles.navLink} ${houses ? styles.navOn : ""}`}
            aria-current={houses ? "page" : undefined}
            data-testid="missio-nav-house-churches"
            onClick={onNavigate}
          >
            <HouseIcon />
            <span>House churches</span>
          </Link>
        ) : null}
        <div className={styles.soon} aria-disabled="true">
          <PeopleIcon />
          <span>Teams</span>
          <span className={styles.soonTag}>Soon</span>
        </div>
      </nav>
      <div className={styles.me}>
        <span className={styles.avatar}>M</span>
        <div>
          <div className={styles.who}>{roleLabel(me.rolesByOrg.missio ?? [])}</div>
          <div className={styles.role}>{missio?.name ?? "Missio"}</div>
        </div>
      </div>
    </aside>
  );
}

function OrgHeader({ state }: { state: OrgHeaderState }) {
  if (state.kind === "switcher") {
    return <OrgSwitcher orgs={state.orgs} currentOrg="missio" />;
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

function MissioTop({
  me,
  ffsaRoleNames,
  navOpen,
}: {
  me: MissioMe;
  ffsaRoleNames: string[] | null;
  navOpen: boolean;
}) {
  const pathname = usePathname();
  const section = pathname.startsWith("/missio/people")
    ? "People"
    : pathname.startsWith("/missio/house-churches")
      ? "House churches"
      : "Home";
  const orgName = me.orgs.find((org) => org.slug === "missio")?.name ?? "Missio";
  const header = missioOrgHeader({ orgs: me.orgs, ffsaRoleNames });
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
          <MenuIcon />
        </button>
      </SheetTrigger>
      {header.kind === "switcher" ? (
        <div className={styles.topOrg}>
          <OrgSwitcher orgs={header.orgs} currentOrg="missio" compact />
        </div>
      ) : null}
      <span className={styles.crumb}>
        {orgName} / <b>{section}</b>
      </span>
      <span className={styles.spacer} />
      <span className={styles.ent}>
        <span className={styles.dot} />
        <span className={styles.entName}>{orgName}</span>
      </span>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  pastor: "Pastor",
  admin: "Admin",
  house_church_leader: "House church leader",
  team_leader: "Team leader",
  finance: "Finance",
};

function roleLabel(roles: string[]): string {
  const role = roles.find((item) => item === "pastor") ?? roles[0];
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

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function HouseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M7 9.8V20h10V9.8" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2" />
    </svg>
  );
}
