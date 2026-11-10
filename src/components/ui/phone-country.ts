export type DialCountry = { iso: string; dial: string };

/**
 * Pick a country from digits typed after "+" or "00".
 * A short prefix that is still the start of a longer dial (NANP +1 vs
 * Bahamas +1242) waits until the extra digits rule the longer code out.
 */
export function matchDial(
  internationalDigits: string,
  countries: readonly DialCountry[]
): DialCountry | null {
  const dials = countries
    .map((country) => ({ country, digits: country.dial.replace(/\D/g, "") }))
    .filter((entry) => entry.digits.length > 0);

  const matches = dials.filter((entry) => internationalDigits.startsWith(entry.digits));
  if (matches.length === 0) return null;

  const ambiguous = dials.some(
    (entry) =>
      entry.digits.length > internationalDigits.length &&
      entry.digits.startsWith(internationalDigits)
  );
  if (ambiguous) return null;

  const longest = Math.max(...matches.map((entry) => entry.digits.length));
  return matches.find((entry) => entry.digits.length === longest)?.country ?? null;
}
