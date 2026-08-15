"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

// Shared chrome for dashboard widgets — the card border, header and optional
// "view all" link that every existing card was repeating inline.
export function WidgetShell({
  title,
  href,
  hrefLabel = "View all",
  children,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-ink bg-surface-1">
      <div className="section-bar">
        <span className="section-bar-title">{title}</span>
        {href && (
          <Link href={href} className="section-bar-meta flex items-center gap-1 !text-[var(--text-tertiary)] hover:!text-white">
            {hrefLabel} <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

// A labelled number, used for the headcount tiles inside widgets.
export function Metric({
  label,
  value,
  accent = false,
  suffix,
}: {
  label: string;
  value: number | string | null;
  accent?: boolean;
  suffix?: string;
}) {
  return (
    <div>
      <p className="mono-label mb-1">{label}</p>
      <p className="numeral text-[28px]">
        {value === null ? "—" : value}
        {value !== null && suffix ? (
          <span className="text-[0.9rem] text-[color:var(--text-tertiary)]">{suffix}</span>
        ) : null}
        {accent && <span className="ml-2 inline-block h-[3px] w-4 align-middle bg-yellow" />}
      </p>
    </div>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-8 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]">
      {children}
    </p>
  );
}
