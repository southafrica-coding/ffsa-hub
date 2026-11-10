"use client";

/**
 * FFSA Hub — design-system primitives
 * NEW FILE: src/components/ffsa/index.tsx
 *
 * Build these once. Every screen composes them.
 * Rules they encode:
 *   · one Masthead per page
 *   · at most ONE NeedsYou per page — two stops it working
 *   · numerals are condensed black + tabular
 *   · nothing is rounded, nothing is elevated
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/* ── Masthead ─────────────────────────────────────── */
export function Masthead({
  context,
  title,
  actions,
}: {
  context: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    // Stacks on phones: actions sitting beside a 58px condensed title squeeze
    // it to a couple of characters per line on a narrow screen.
    <div className="flex flex-col gap-4 border-b border-ink bg-white px-5 pb-4 pt-5 md:flex-row md:items-end md:justify-between md:gap-8 md:px-8 md:pb-5 md:pt-6">
      <div className="min-w-0">
        <div className="masthead-context">{context}</div>
        <h1 className="masthead-title">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5 md:pb-1">{actions}</div>}
    </div>
  );
}

/* ── The one yellow band ──────────────────────────── */
export function NeedsYou({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="needs-you">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="needs-you-tag">NEEDS YOU</span>
        <span className="needs-you-text">{children}</span>
      </div>
      {action}
    </div>
  );
}

/** A masthead's primary action. Black, never yellow — see the handoff rules. */
export function MastheadAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white"
    >
      {children}
    </Link>
  );
}

/** The same shape as MastheadAction, for screens whose action is not a link. */
export function MastheadButton({
  onClick,
  tone = "solid",
  children,
}: {
  onClick?: () => void;
  /** `solid` is the primary; `outline` is the bone-filled secondary beside it. */
  tone?: "solid" | "outline";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center border px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]",
        tone === "solid"
          ? "border-ink bg-ink text-white hover:bg-[#262622]"
          : "border-ink bg-bone text-ink hover:bg-bone-2"
      )}
    >
      {children}
    </button>
  );
}

/** The band's black-on-yellow action. Lives here so it can't drift per screen. */
export function NeedsYouAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow hover:bg-[#262622]"
    >
      {children}
    </Link>
  );
}

/* ── Right-hand drawer ────────────────────────────── */
/**
 * Frame 9a's panel: 470px, slides over the screen rather than replacing it, so
 * the wall stays visible behind and you can click straight through to the next
 * block. Full width below sm, where 470px is the whole screen anyway.
 *
 * Deliberately not the shadcn Dialog: that one centres, traps the page and
 * re-mounts its content, none of which the design's "stays open while you move
 * between sets" behaviour wants.
 */
export function Drawer({
  open,
  onClose,
  label,
  onPrev,
  onNext,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  onPrev?: () => void;
  onNext?: () => void;
  children: React.ReactNode;
}) {
  // Portalled to <body>. The admin shell's content column carries
  // `animate-fade-up`, and a transform on an ancestor makes it the containing
  // block for position:fixed — which sized the drawer to the whole scrolled
  // page and pushed its footer below the fold.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowUp" && onPrev) onPrev();
      if (e.key === "ArrowDown" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onPrev, onNext]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      {/* The scrim dims the screen without hiding it — 9a keeps the week readable. */}
      <div
        className="fixed inset-0 z-40 bg-[rgba(10,10,10,0.22)]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={label}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-ink bg-white sm:w-[470px]"
      >
        <div className="flex shrink-0 items-center justify-between bg-ink px-6 py-3.5">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-yellow">
            {label}
          </span>
          <div className="flex items-center gap-4 font-mono text-[10px] font-bold tracking-[0.12em] text-[#8E8A7C]">
            {onPrev && (
              <button type="button" onClick={onPrev} className="hover:text-white">
                ↑ PREV
              </button>
            )}
            {onNext && (
              <button type="button" onClick={onNext} className="hover:text-white">
                NEXT ↓
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center text-[16px] text-white">
              ✕
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </aside>
    </>,
    document.body
  );
}

/* ── Module tab strip ─────────────────────────────── */
/** Frames 10a / 12a: squared mono tabs sitting on the black page rule. */
export function ModuleTabs({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: { key: string; label: string; mark?: boolean }[];
  active: string;
  onChange: (key: string) => void;
  /** Filter chips, which 10a hangs off the right of the same rule. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-y-2 border-b border-ink px-5 pt-4 md:px-8">
      <div className="flex flex-wrap items-end">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={cn(
                "flex min-h-11 items-center gap-1.5 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
                on
                  ? "bg-ink text-white"
                  : "border border-b-0 border-rule text-[#7C786C] hover:text-ink"
              )}
            >
              {t.mark && <span className={cn("h-2.5 w-2.5", on ? "bg-yellow" : "bg-rule-strong")} />}
              {t.label}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-2">{trailing}</div>}
    </div>
  );
}

/* ── Black section bar ────────────────────────────── */
export function SectionBar({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="section-bar">
      <span className="section-bar-title">{title}</span>
      {meta && <span className="section-bar-meta">{meta}</span>}
    </div>
  );
}

/* ── Status pill ──────────────────────────────────── */
// Exported: screens map their own domain statuses onto these tones.
export type Tone = "good" | "warn" | "quiet" | "bad";
const TONE: Record<Tone, string> = {
  good: "border-grass text-grass-text",
  warn: "border-amber-border text-amber",
  quiet: "border-rule-strong text-[#55524A]",
  bad: "border-destructive text-destructive",
};
export function StatusPill({ tone = "quiet", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]", TONE[tone])}>
      {children}
    </span>
  );
}

/* ── Mono chip (filters, saved views, tags) ───────── */
export function Chip({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <span className="chip" data-active={active ? "true" : undefined}>{children}</span>;
}

/* ── Numeral ──────────────────────────────────────── */
export function Numeral({ children, size = 54, sub }: { children: React.ReactNode; size?: number; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="numeral" style={{ fontSize: size }}>{children}</span>
      {sub && <span className="numeral text-[#7C786C]" style={{ fontSize: size * 0.42 }}>{sub}</span>}
    </div>
  );
}

/* ── KPI strip ────────────────────────────────────── */
export function KpiStrip({ children }: { children: React.ReactNode }) {
  // Two-up on phones, four-up from md — the cells stay legible rather than
  // crushing four 54px numerals into a 375px screen.
  return <div className="grid grid-cols-2 border-b border-ink md:grid-cols-4">{children}</div>;
}
export function Kpi({
  label,
  value,
  foot,
  lead,
  tick,
  size = 54,
  valueColor,
  bar,
}: {
  label: string;
  value: string;
  foot?: string;
  /** Bone background, marking the strip's headline figure. */
  lead?: boolean;
  /** The yellow hairline beside a lead figure. Defaults on with `lead`; turn
   *  it off on a screen where the accent would compete with something. */
  tick?: boolean;
  /** Drop to ~26 for cells holding formatted money, which won't fit at 54px. */
  size?: number;
  valueColor?: string;
  /** A ratio to draw under the figure. Pass only when one really exists. */
  bar?: { pct: number; tone?: string };
}) {
  const showTick = tick ?? lead;
  return (
    <div className={cn("kpi", lead && "bg-bone")}>
      <div className="mono-label mb-2.5">{label}</div>
      <div className="flex items-end gap-2.5">
        <span
          className="numeral leading-none"
          style={{ fontSize: `clamp(22px, 7vw, ${size}px)`, color: valueColor }}
        >
          {value}
        </span>
        {showTick && <span className="mb-2 h-[3px] w-5 bg-yellow" />}
      </div>
      {bar && (
        <div className="mt-3.5">
          <Bar pct={bar.pct} tone={bar.tone} />
        </div>
      )}
      {foot && <div className="mt-2.5 font-mono text-[10px] tracking-[0.08em] text-[#55524A]">{foot}</div>}
    </div>
  );
}

/* ── Progress bar ─────────────────────────────────── */
export function Bar({ pct, tone = "#0A0A0A" }: { pct: number; tone?: string }) {
  return (
    <div className="bar">
      <span style={{ width: Math.min(100, Math.max(0, pct)) + "%", background: tone }} />
    </div>
  );
}

/* ── Square initials avatar ───────────────────────── */
export function Initials({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 3).join("");
  return (
    <span className="avatar-square shrink-0" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </span>
  );
}

/* ── Date block (event rows) ──────────────────────── */
export {
  PageHeading,
  SectionHeading,
  EmptyNote,
  LocalTabs,
  StackLink,
  DataTable,
  ServiceCard,
} from "./department-ui";
export { MoneyCell } from "./money-cell";
export {
  Breadcrumbs,
  Toolbar,
  PropertyList,
  KpiTile,
  Skeleton,
  SideSheet,
  EmptyState,
  ListPage,
  DetailPage,
  DashboardPage,
  MoneyTablePage,
  ServicePage,
} from "./templates";

export function DateBlock({ day, mon, invert }: { day: string; mon: string; invert?: boolean }) {
  return (
    <div className={cn("w-12 shrink-0 border py-1.5 text-center",
      invert ? "border-ink bg-ink" : "border-rule-strong bg-bone")}>
      <div className={cn("font-display text-[20px] font-black leading-none", invert ? "text-white" : "text-ink")}>{day}</div>
      <div className={cn("font-mono text-[8px] tracking-[0.14em]", invert ? "text-yellow" : "text-[#7C786C]")}>{mon}</div>
    </div>
  );
}
