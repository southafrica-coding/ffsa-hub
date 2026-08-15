"use client";

import { Kpi } from "@/components/ffsa";

// Amber marks a ratio worth a look, red one that has broken its ceiling.
// Brand yellow never appears here — it belongs to the NeedsYou band alone.
export function barTone(pct: number): string | undefined {
  if (pct > 100) return "hsl(var(--destructive))";
  if (pct >= 80) return "var(--amber-border)";
  return undefined;
}

/**
 * A KpiStrip cell for money.
 *
 * Same shape as the shared `Kpi`, but it runs the numeral smaller and can carry
 * a Bar: a formatted ZAR total does not fit in a quarter-width cell at 54px, and
 * the finance strips are only readable when each figure shows what it is
 * measured against. Pass `pct` only when there is a real ratio behind it.
 */
export function MoneyKpi({
  label,
  value,
  foot,
  pct,
  tone,
  lead,
  negative,
  positive,
}: {
  label: string;
  value: string;
  foot?: string;
  pct?: number;
  tone?: string;
  lead?: boolean;
  negative?: boolean;
  positive?: boolean;
}) {
  const colour = negative
    ? "hsl(var(--destructive))"
    : positive
      ? "var(--green-text)"
      : undefined;

  return (
    <Kpi
      label={label}
      value={value}
      foot={foot}
      lead={lead}
      // Bone background but no yellow hairline: these screens carry a NeedsYou
      // band, and the band is where the eye should go.
      tick={false}
      size={26}
      valueColor={colour}
      bar={pct !== undefined ? { pct, tone: negative ? "hsl(var(--destructive))" : tone } : undefined}
    />
  );
}
