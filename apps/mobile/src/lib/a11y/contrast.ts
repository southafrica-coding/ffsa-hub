// WCAG 2.x contrast maths, pure (no React Native), so the token tests and the
// accessibility audit (docs/accessibility.md) compute ratios the same way.

/** Relative luminance of a #RRGGBB colour (WCAG 2.x definition). */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG AA minimums: 4.5:1 for body text, 3:1 for large text (24dp, or 18.7dp
 * bold) and for UI parts that convey meaning (outlines, focus, icons).
 */
export const AA = { text: 4.5, large: 3, ui: 3 } as const;

export function meetsAA(fg: string, bg: string, kind: keyof typeof AA = "text"): boolean {
  return contrastRatio(fg, bg) >= AA[kind];
}

/** "4.52:1" — for docs and test names. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
