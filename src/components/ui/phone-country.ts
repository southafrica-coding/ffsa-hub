export type DialCountry = { iso: string; dial: string };

/**
 * Pick a country from digits typed after "+" or "00".
 * A short prefix that is still the start of a longer dial (NANP +1 vs
 * Bahamas +1242) waits until the extra digits rule the longer code out.
 */
export function formatStoredPhone(
  dial: string,
  nationalRaw: string,
  storage: "display" | "e164",
  separator = " "
): string {
  const digits = nationalRaw.replace(/\D/g, "");
  if (!digits) return "";
  if (storage === "e164") return `${dial}${digits}`;
  return `${dial}${separator}${digits}`;
}

/**
 * What to store while the person is typing. A half-typed or unmatched
 * "+…" / "00…" clears the stored value and leaves the box as they typed it.
 * A leading 0 after the country code is kept.
 */
export function phoneEdit(
  raw: string,
  currentDial: string,
  countries: readonly DialCountry[],
  storage: "display" | "e164" = "display",
  separator = " "
): { national: string; iso: string | null; stored: string } {
  const compact = raw.replace(/\s/g, "");
  const international = compact.startsWith("+")
    ? compact.slice(1).replace(/\D/g, "")
    : compact.startsWith("00")
      ? compact.slice(2).replace(/\D/g, "")
      : null;
  if (international !== null) {
    const match = matchDial(international, countries);
    if (!match) return { national: raw, iso: null, stored: "" };
    const rest = international.slice(match.dial.replace(/\D/g, "").length);
    if (!rest) return { national: raw, iso: null, stored: "" };
    return {
      national: rest,
      iso: match.iso,
      stored: formatStoredPhone(match.dial, rest, storage, separator),
    };
  }
  return {
    national: raw,
    iso: null,
    stored: formatStoredPhone(currentDial, raw, storage, separator),
  };
}

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
