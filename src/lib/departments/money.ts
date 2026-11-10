/**
 * Fixed South African rand formatter. Integer cents in, whole rands out.
 * Groups with a regular space: 1_234_500 → "R 12 345".
 */
export function formatZarFromCents(cents: number): string {
  const negative = cents < 0;
  const rands = Math.round(Math.abs(cents) / 100);
  const grouped = String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}R ${grouped}`;
}
