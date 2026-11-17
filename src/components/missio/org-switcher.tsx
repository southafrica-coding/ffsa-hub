"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { orgHref } from "./access";
import styles from "./org-switcher.module.css";
import { useOrgSwitcher, type OrgSwitcherProps } from "./use-org-switcher";

const BLURB: Record<string, string> = {
  ffsa: "FFSA Hub",
  missio: "Missio",
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
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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
        {ordered.map((org) => {
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
              ) : null}
            </a>
          );
        })}
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

