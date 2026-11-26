"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FailureKind } from "./api";
import type { L10Headline } from "./types";
import { initials } from "./derive";
import styles from "./l10.module.css";

/** Fixed copy per failure. Server text is never shown. */
export function failureCopy(kind: FailureKind): string {
  switch (kind) {
    case "unauthenticated":
      return "Your session has ended. Sign in again to carry on.";
    case "forbidden":
      return "You're not on this team, so you can't see its L10.";
    case "not_found":
      return "That isn't here any more. It may have been removed.";
    case "conflict":
      return "Someone else changed this just now. Refresh to catch up.";
    case "invalid":
      return "That didn't go through. Check it and try again.";
    case "error":
      return "Something went wrong. Try again in a moment.";
  }
}

/**
 * The current time, re-read every `intervalMs` and whenever the tab comes
 * back. Callers compute from timestamps, so a missed tick never drifts.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);
  return now;
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={small ? styles.avatarSmall : styles.avatar} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.back}>
      ← {children}
    </Link>
  );
}

export function Masthead({ context, title, children }: { context: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className={styles.masthead}>
      <span className={styles.tick} aria-hidden="true" />
      <div className={styles.context}>{context}</div>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </header>
  );
}

export function SectionBar({ id, title, meta }: { id?: string; title: string; meta?: ReactNode }) {
  return (
    <div id={id} className={styles.bar}>
      <h2 className={styles.barTitle}>{title}</h2>
      {meta != null ? <span>{meta}</span> : null}
    </div>
  );
}

/** `as="li"` inside a list. */
export function Empty({ children, as = "p" }: { children: ReactNode; as?: "p" | "li" }) {
  const Tag = as;
  return <Tag className={styles.empty}>{children}</Tag>;
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className={styles.notice} role="alert">
      {children}
    </p>
  );
}

export function Checkbox({
  checked,
  label,
  disabled,
  onToggle,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.check}
      onClick={onToggle}
    >
      <span className={checked ? styles.checkOn : styles.checkBox}>{checked ? "✓" : ""}</span>
    </button>
  );
}


/** Non-members get a 404 from #741 on a team route. Fixed copy, no server text. */
export function TeamNotFound({ href }: { href: string }) {
  return (
    <div className={`${styles.root} ${styles.page}`}>
      <BackLink href={href}>All teams</BackLink>
      <Masthead title="L10 team not found" context="L10" />
      <p className={styles.empty}>This team isn&apos;t here, or you don&apos;t have access to it.</p>
    </div>
  );
}

/**
 * Cross-team auto headline: expandable, dismissable, never edited.
 * `sourceTeamName` is the paired team (e.g. Production on Live's page).
 */
export function AutoRecapCard({
  headline,
  sourceTeamName,
  onDismiss,
  dismissing,
}: {
  headline: L10Headline;
  sourceTeamName: string | null;
  onDismiss?: () => void;
  dismissing?: boolean;
}) {
  const title = sourceTeamName ? `Auto recap from ${sourceTeamName}` : "Auto recap";
  return (
    <details className={styles.autoRecap}>
      <summary className={styles.autoRecapSummary}>
        <span className={styles.autoTag}>Auto</span>
        <span className={styles.autoRecapTitle}>{title}</span>
      </summary>
      <div className={styles.autoRecapBody}>{headline.body}</div>
      {onDismiss ? (
        <div className={styles.autoRecapActions}>
          <button type="button" className={styles.btn} onClick={onDismiss} disabled={dismissing}>
            {dismissing ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      ) : null}
    </details>
  );
}
