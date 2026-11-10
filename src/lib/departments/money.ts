const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Whole rands, South Africa only.
 * `en-ZA` groups with a non-breaking space: `R\u00a0186\u00a0000`.
 */
export function formatZar(amountRand: number): string {
  return zar.format(amountRand);
}
