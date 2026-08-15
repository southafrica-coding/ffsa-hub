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
    <div className="flex items-end justify-between gap-8 border-b border-ink bg-white px-8 pb-5 pt-6">
      <div>
        <div className="masthead-context">{context}</div>
        <h1 className="masthead-title">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5 pb-1">{actions}</div>}
    </div>
  );
}

/* ── The one yellow band ──────────────────────────── */
export function NeedsYou({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="needs-you">
      <div className="flex items-center gap-3.5">
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
      className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white"
    >
      {children}
    </Link>
  );
}

/** The band's black-on-yellow action. Lives here so it can't drift per screen. */
export function NeedsYouAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow hover:bg-[#262622]"
    >
      {children}
    </Link>
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
export function Kpi({ label, value, foot, lead }: { label: string; value: string; foot?: string; lead?: boolean }) {
  return (
    <div className={cn("kpi", lead && "bg-bone")}>
      <div className="mono-label mb-2.5">{label}</div>
      <div className="flex items-end gap-2.5">
        <span className="numeral text-[54px]">{value}</span>
        {lead && <span className="mb-2 h-[3px] w-5 bg-yellow" />}
      </div>
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
export function DateBlock({ day, mon, invert }: { day: string; mon: string; invert?: boolean }) {
  return (
    <div className={cn("w-12 shrink-0 border py-1.5 text-center",
      invert ? "border-ink bg-ink" : "border-rule-strong bg-bone")}>
      <div className={cn("font-display text-[20px] font-black leading-none", invert ? "text-white" : "text-ink")}>{day}</div>
      <div className={cn("font-mono text-[8px] tracking-[0.14em]", invert ? "text-yellow" : "text-[#7C786C]")}>{mon}</div>
    </div>
  );
}
