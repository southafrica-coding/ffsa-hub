// Nationality → country code for visa_country_rules.
//
// The Hub stores nationality as the country's name from COUNTRY_OPTIONS
// (e.g. "United States"); visa_country_rules is keyed by ISO code. Older
// rows sometimes hold the demonym ("American"), so both are accepted.

import { COUNTRIES } from "@/lib/profile/options";

const BY_NAME = new Map<string, string>();
for (const c of COUNTRIES) {
  BY_NAME.set(c.name.trim().toLowerCase(), c.iso);
  // A demonym shared by two countries (e.g. "Congolese") is ambiguous: skip it.
  const key = c.nationality.trim().toLowerCase();
  if (BY_NAME.has(key) && BY_NAME.get(key) !== c.iso) BY_NAME.set(key, "");
  else if (!BY_NAME.has(key)) BY_NAME.set(key, c.iso);
}

/** ISO code for a stored nationality, or null when unknown or ambiguous. */
export function countryIsoFor(nationality: string | null | undefined): string | null {
  if (!nationality) return null;
  const iso = BY_NAME.get(nationality.trim().toLowerCase());
  return iso ? iso : null;
}

/** South Africans need no visa case at all. */
export function isSouthAfrican(nationality: string | null | undefined): boolean {
  return countryIsoFor(nationality) === "ZA";
}
