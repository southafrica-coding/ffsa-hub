// Equipment money is integer ZAR cents, excl. VAT (spec rule 10). Display is
// "R 1 250.00": an ordinary space before the number and between thousands,
// a point before the cents. Intl's en-ZA output uses a comma decimal and a
// non-breaking space, so this is written out by hand.

export function rands(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const part = (abs % 100).toString().padStart(2, "0");
  return `${sign}R ${whole}.${part}`;
}

/** "R 750" when there are no cents, else the full "R 750.50" — for cards. */
export function randsShort(cents: number): string {
  return Math.round(cents) % 100 === 0 ? rands(cents).slice(0, -3) : rands(cents);
}
