import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { missioSkinVars } from "../access";
import { missioBody, missioDisplay, missioMono } from "../fonts";
import { MissioOrgRoot } from "../org-root";
import styles from "./guide.module.css";

/** "Sunday · 22 Nov 2026" (the day it really is, so a Wednesday house reads Wednesday). */
export function meetingLabel(iso: string): { day: string; date: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { day: "", date: iso };
  return {
    day: new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: "UTC" }).format(d),
    date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d),
  };
}

const skin = missioSkinVars() as CSSProperties;

/**
 * The page ground and the MISSIŌ wordmark bar (board M4a): paper page, the
 * wordmark centred, an optional link on the right. Always light; Missio has no
 * dark page theme.
 */
export function GuideSurface({
  children,
  nav,
  state,
}: {
  children: ReactNode;
  /** The right-hand label in the top bar. */
  nav?: { label: string; href?: string } | null;
  state?: string;
}) {
  return (
    <div
      className={`${styles.surface} ${missioBody.variable} ${missioDisplay.variable} ${missioMono.variable}`}
      style={skin}
      data-skin="missio"
      data-state={state}
    >
      <MissioOrgRoot />
      <header className={styles.top}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 2 KB wordmark, no layout shift */}
        <img className={styles.mark} src="/brands/missio/missio-wordmark.png" alt="Missio" width={79} height={22} />
        {nav ? (
          nav.href ? (
            <a className={styles.navlabel} href={nav.href}>
              {nav.label} ↗
            </a>
          ) : (
            <span className={`${styles.navlabel} ${styles.navplain}`}>{nav.label}</span>
          )
        ) : null}
      </header>
      {children}
    </div>
  );
}

/** A full-page message in the same look: bad link, too many tries, not open yet. */
export function GuideStatus({
  eyebrow,
  title,
  body,
  nav,
  state,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  nav?: { label: string; href?: string } | null;
  state: string;
  action?: { label: string; href: string };
}) {
  return (
    <GuideSurface nav={nav} state={state}>
      <main className={styles.intro}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.h1}>{title}</h1>
        <p className={styles.lede}>{body}</p>
        {action ? (
          <a className={styles.quietBtn} href={action.href}>
            {action.label}
          </a>
        ) : null}
      </main>
    </GuideSurface>
  );
}
