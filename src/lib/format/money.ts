// Fixed South African rand format. Intl en-ZA differs by browser (group
// separators, spaces), the same reason src/lib/format/sa-time.ts assembles
// its own string. Thousands are a normal space.
//
// Inputs are integer cents. The default is whole rands, rounded to the
// nearest rand (half away from zero). Cents are only shown when asked.

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

function grouped(amount: number): string {
  return String(amount).replace(GROUP, " ");
}

/** Nearest rand. Half a rand rounds away from zero, including negatives. */
function nearestRand(cents: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(cents) / 100);
}

export function formatZarFromCents(
  cents: number,
  options?: { showCents?: boolean }
): string {
  if (!Number.isFinite(cents)) return options?.showCents ? "R 0,00" : "R 0";
  const negative = cents < 0;
  const abs = Math.abs(cents);

  if (options?.showCents) {
    const rounded = Math.round(abs);
    const rands = Math.floor(rounded / 100);
    const fraction = String(rounded % 100).padStart(2, "0");
    const body = `R ${grouped(rands)},${fraction}`;
    return negative ? `-${body}` : body;
  }

  const rands = Math.abs(nearestRand(cents));
  const body = `R ${grouped(rands)}`;
  return negative && rands !== 0 ? `-${body}` : body;
}
