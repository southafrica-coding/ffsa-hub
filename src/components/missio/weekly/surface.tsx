import type { ReactNode } from "react";
import { guideBody, guideDisplay } from "./fonts";
import styles from "./guide.module.css";

export type GuideTheme = "light" | "dark";

/** "Sunday · 22 Nov 2026" (the day it really is, so a Wednesday house reads Wednesday). */
export function meetingLabel(iso: string): { day: string; date: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { day: "", date: iso };
  return {
    day: new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: "UTC" }).format(d),
    date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d),
  };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The page ground and the MISSIŌ SA top bar. Light (paper) unless the Hub
 * is in dark mode or `theme` forces one.
 */
export function GuideSurface({
  children,
  nav,
  theme,
  state,
}: {
  children: ReactNode;
  /** The right-hand label in the top bar. */
  nav?: { label: string; href?: string } | null;
  theme?: GuideTheme;
  state?: string;
}) {
  return (
    <div
      className={`${styles.surface} ${guideBody.variable} ${guideDisplay.variable}`}
      data-theme={theme}
      data-skin="missio-guide"
      data-state={state}
    >
      <header className={styles.top}>
        <div className={styles.mark} aria-label="MissioSA">
          MISSIŌ<span className={styles.sa}>SA</span>
        </div>
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
  theme,
  state,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  nav?: { label: string; href?: string } | null;
  theme?: GuideTheme;
  state: string;
  action?: { label: string; href: string };
}) {
  return (
    <GuideSurface nav={nav} theme={theme} state={state}>
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
