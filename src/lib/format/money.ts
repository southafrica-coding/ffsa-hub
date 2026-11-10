// Fixed South African rand format. Intl en-ZA differs by browser (group
// separators, spaces), the same reason src/lib/format/sa-time.ts assembles
// its own string. Group with a normal space, decimal comma, two fractions.
//
// Amounts are integer cents so a rand never depends on binary fractions.

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

export function formatZarFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "R 0,00";
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const rands = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  const grouped = String(rands).replace(GROUP, " ");
  const body = `R ${grouped},${fraction}`;
  return negative ? `-${body}` : body;
}
