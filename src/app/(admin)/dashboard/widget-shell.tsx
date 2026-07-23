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
    <div
      style={{
        background: "hsl(22 10% 8%)",
        border: "1px solid hsl(22 8% 14%)",
        borderRadius: "14px",
        overflow: "hidden",
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid hsl(22 8% 13%)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
            fontSize: "1.15rem",
            letterSpacing: "0.07em",
            color: "#F0EBE3",
          }}
        >
          {title}
        </p>
        {href && (
          <Link
            href={href}
            style={{
              fontSize: "9px",
              letterSpacing: "0.2em",
              color: "hsl(42 95% 55%)",
              textTransform: "uppercase",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
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
      <p
        style={{
          fontSize: "9px",
          letterSpacing: "0.18em",
          fontWeight: 700,
          color: "hsl(30 8% 42%)",
          textTransform: "uppercase",
          marginBottom: "4px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
          fontSize: "1.75rem",
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: accent ? "hsl(42 95% 58%)" : "#F0EBE3",
        }}
      >
        {value === null ? "—" : value}
        {value !== null && suffix ? (
          <span style={{ fontSize: "0.9rem", opacity: 0.65 }}>{suffix}</span>
        ) : null}
      </p>
    </div>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        padding: "2rem 1.5rem",
        textAlign: "center",
        fontSize: "12px",
        color: "hsl(30 8% 35%)",
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </p>
  );
}
