"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { orgHref } from "./access";
import styles from "./org-switcher.module.css";
import { useOrgSwitcher, type OrgSwitcherProps } from "./use-org-switcher";

const BLURB: Record<string, string> = {
  ffsa: "FFSA Hub · staff workspace",
  missio: "Church plant · own people & books",
};

export function OrgTile({ slug, large = false }: { slug: string; large?: boolean }) {
  const missio = slug === "missio";
  return (
    <span className={`${styles.tile} ${large ? styles.tileLg : ""} ${missio ? styles.tileMi : styles.tileFf}`}>
      {missio ? "M" : "FF"}
    </span>
  );
}

export function OrgSwitcher({ orgs, currentOrg, onSwitch, compact = false }: OrgSwitcherProps & { compact?: boolean }) {
  const { open, setOpen, ordered, visible, skin, current, choose } = useOrgSwitcher({
    orgs,
    currentOrg,
    onSwitch,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!visible) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      const index = Number(event.key) - 1;
      const org = ordered[index];
      if (!org || org.slug === currentOrg) return;
      event.preventDefault();
      if (onSwitch) onSwitch(org.slug);
      else window.location.assign(org.href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, ordered, currentOrg, onSwitch, setOpen]);

  if (!visible || !current) return null;

  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const menu = open ? (
    <>
      <button type="button" className={styles.dim} aria-label="Close organisations" onClick={() => setOpen(false)} />
      <div
        id={menuId}
        role="listbox"
        aria-label="Organisations"
        className={styles.menu}
        style={{
          top: Math.max(8, rect?.top ?? 8),
          left: Math.min((rect?.right ?? 80) + 12, Math.max(8, window.innerWidth - 336)),
        }}
      >
        <div className={styles.lbl}>Organisations</div>
        {ordered.map((org, index) => {
          const selected = org.slug === currentOrg;
          return (
            <a
              key={org.id}
              href={org.href || orgHref(org.slug)}
              role="option"
              aria-selected={selected}
              className={`${styles.item} ${selected ? styles.current : ""}`}
              onClick={(event) => {
                choose(org.slug);
                if (onSwitch) event.preventDefault();
              }}
            >
              <OrgTile slug={org.slug} large />
              <span className={styles.itemText}>
                <span className={styles.itemName}>{org.name}</span>
                {BLURB[org.slug] ? <span className={styles.itemBlurb}>{BLURB[org.slug]}</span> : null}
              </span>
              {selected ? (
                <span className={styles.check} aria-hidden>
                  <CheckIcon />
                </span>
              ) : (
                <span className={styles.kbd}>{index + 1}</span>
              )}
            </a>
          );
        })}
        <div className={styles.sep} />
        <div className={styles.foot}>
          <ShareIcon />
          <span>Hire, Rooms and Calendar are shared</span>
        </div>
        <div className={styles.foot} style={{ paddingTop: 0 }}>
          <LockIcon />
          <span>People, kids and giving stay with each org</span>
        </div>
      </div>
    </>
  ) : null;

  return (
    <div
      className={`${styles.anchor} ${compact ? styles.compact : ""}`}
      data-org-switcher=""
      data-skin={skin}
      data-org={current.slug}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Organisations, ${current.name}`}
        title={current.name}
        onClick={() => setOpen((value) => !value)}
      >
        <OrgTile slug={current.slug} />
        <span className={styles.name}>{current.name}</span>
        <span className={styles.chev} aria-hidden>
          <ChevronIcon />
        </span>
      </button>
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
