// Money in the Store is integer ZAR cents. Shown as "R 1 250" / "R 89.50".

export function formatZar(cents: number): string {
  const rands = cents / 100;
  const whole = Number.isInteger(rands);
  const formatted = rands
    .toFixed(whole ? 0 : 2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R ${formatted}`;
}

/** "250" / "250.5" / "R250,50" → cents. Null when it isn't a price. */
export function parseRandsToCents(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  const cleaned = input.replace(/[R\s ]/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
