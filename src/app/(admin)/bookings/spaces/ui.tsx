// Small presentational helpers shared across the bookings views. No hooks, so
// these are safe to render from both server and client components.

import { cn } from "@/lib/utils/cn";
import { statusLabel } from "@/lib/bookings/status";

// Tone mapping lives here rather than in src/lib/bookings/status.ts because the
// lib helpers still return the old dark-theme hues; the design system only has
// four pill tones and every one of them is outlined, never filled.
const TONE: Record<string, string> = {
  approved: "border-grass text-grass-text",
  pending: "border-amber-border text-amber",
  denied: "border-destructive text-destructive",
  cancelled: "border-rule-strong text-[color:var(--text-muted)]",
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
        TONE[status] ?? TONE.cancelled,
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ColorDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  // Square, like every other mark in the system — the venue/ministry colour is
  // data, so it stays, but the shape does not.
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Calendar / time-grid block styling. Replaces the dark-theme statusChipStyle
 * in src/lib/bookings/status.ts: the schedule reads as paper, so an ordinary
 * booking is a bone block and a withdrawn one falls back to plain white with
 * the title struck through. Yellow is never used — it belongs to the one
 * "needs you" band per screen.
 */
export function bookingBlockStyle(status: string): {
  background: string;
  color: string;
  border: string;
  textDecoration?: string;
} {
  switch (status) {
    case "approved":
      return {
        background: "var(--surface-3)",
        color: "var(--text-primary)",
        border: "1px solid var(--rule-strong)",
      };
    case "pending":
      return {
        background: "var(--surface-1)",
        color: "var(--text-secondary)",
        border: "1px dashed var(--rule-strong)",
      };
    case "denied":
    case "cancelled":
      return {
        background: "var(--surface-1)",
        color: "var(--text-tertiary)",
        border: "1px solid var(--rule)",
        textDecoration: "line-through",
      };
    default:
      return {
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        border: "1px solid var(--rule)",
      };
  }
}
