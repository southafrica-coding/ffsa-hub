"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { orgHref, shouldShowOrgSwitcher, canAccessMissio, missioSkinVars } from "./access";
import { MissioApiError, missioClient, type MissioClient } from "./api";
import { OrgSwitcher, OrgTile } from "./org-switcher";
import type { MissioMe } from "./types-shim";
import styles from "./shell.module.css";

type Gate =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "no-access"; status: 401 | 403 }
  | { kind: "ready"; me: MissioMe };

const skinStyle = missioSkinVars() as CSSProperties;

export function MissioFrame({
  children,
  client = missioClient,
}: {
  children: React.ReactNode;
  client?: MissioClient;
}) {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    client.getMe().then(
      (me) => {
        if (!active) return;
        if (!canAccessMissio(me)) setGate({ kind: "no-access", status: 403 });
        else setGate({ kind: "ready", me });
      },
      (error: unknown) => {
        if (!active) return;
        const code = error instanceof MissioApiError ? error.code : null;
        if (code === "unauthenticated") setGate({ kind: "no-access", status: 401 });
        else if (code === "forbidden") setGate({ kind: "no-access", status: 403 });
        else setGate({ kind: "error" });
      }
    );
    return () => {
      active = false;
    };
  }, [client, attempt]);

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
    <div data-missio-shell="" data-skin="missio" data-access="ready" className={styles.shell} style={skinStyle}>
      <MissioSidebar me={gate.me} />
      <div className={styles.main}>
        <MissioTop orgName={gate.me.orgs.find((org) => org.slug === "missio")?.name ?? "Missio"} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

function MissioSidebar({ me }: { me: MissioMe }) {
  const pathname = usePathname();
  const orgs = me.orgs.map((org) => ({
    id: org.id,
    slug: org.slug,
    name: org.name,
    href: orgHref(org.slug),
  }));
  const missio = me.orgs.find((org) => org.slug === "missio");
  const home = pathname === "/missio";
  const people = pathname.startsWith("/missio/people");

  return (
    <aside className={styles.side}>
      {shouldShowOrgSwitcher(me.orgs.length) ? (
        <OrgSwitcher orgs={orgs} currentOrg="missio" />
      ) : (
        <div className={styles.orgStatic}>
          <OrgTile slug="missio" />
          <span>{missio?.name ?? "Missio"}</span>
        </div>
      )}
      <form className={styles.search} action="/missio/people">
        <SearchIcon />
        <input name="q" placeholder="Search" aria-label="Search Missio" />
      </form>
      <nav className={styles.nav} aria-label="Missio">
        <Link href="/missio" className={`${styles.navLink} ${home ? styles.navOn : ""}`} aria-current={home ? "page" : undefined}>
          <HomeIcon />
          <span>Home</span>
        </Link>
        <Link href="/missio/people" className={`${styles.navLink} ${people ? styles.navOn : ""}`} aria-current={people ? "page" : undefined}>
          <PeopleIcon />
          <span>People</span>
        </Link>
        <div className={styles.soon} aria-disabled="true">
          <HomeIcon />
          <span>House churches</span>
          <span className={styles.soonTag}>Soon</span>
        </div>
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

function MissioTop({ orgName }: { orgName: string }) {
  const pathname = usePathname();
  const section = pathname.startsWith("/missio/people") ? "People" : "Home";
  return (
    <div className={styles.top}>
      <span className={styles.crumb}>
        {orgName} / <b>{section}</b>
      </span>
      <span className={styles.spacer} />
      <span className={styles.ent}>
        <span className={styles.dot} />
        {orgName}
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

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2" />
    </svg>
  );
}
