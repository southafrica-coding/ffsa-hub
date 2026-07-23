// ────────────────────────────────────────────────────────────
// Schools demographics — aggregation
// ────────────────────────────────────────────────────────────
// Pure functions, kept out of the route handler so they can be tested
// without a database.
// ────────────────────────────────────────────────────────────

export type Tier = "A" | "B" | "C";

// Matches the labels used on the billing screens so the dashboard and the
// fee config never disagree about what a tier means.
export const TIER_LABELS: Record<Tier, string> = {
  A: "Tier A — Full Price",
  B: "Tier B — Reduced",
  C: "Tier C — Heavily Reduced",
};

export const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  prefer_not_to_say: "Prefer not to say",
};

// A person counted in a breakdown. `nationality` may come from a user record
// or, for anonymous applicants, from applicant_info.
export type Person = {
  programId: string;
  nationality: string | null;
  gender: string | null;
};

export type Breakdown = {
  total: number;
  // Tier counts plus an explicit unknown bucket. A nationality that matches no
  // country_tiers row lands in `unknown` rather than being silently dropped —
  // an unrecognised country is a data problem worth seeing, not a rounding
  // error to hide.
  tiers: { A: number; B: number; C: number; unknown: number };
  genders: Record<string, number>;
  // country name -> count, unsorted; the caller ranks it.
  nationalities: Record<string, number>;
};

export function emptyBreakdown(): Breakdown {
  return {
    total: 0,
    tiers: { A: 0, B: 0, C: 0, unknown: 0 },
    genders: {},
    nationalities: {},
  };
}

// country_tiers is keyed on country NAME, matched case-insensitively — the
// same rule getCountryTierMap uses in src/services/school-billing.ts.
export function tierFor(
  nationality: string | null,
  tierMap: Record<string, Tier>
): Tier | null {
  if (!nationality) return null;
  return tierMap[nationality.trim().toLowerCase()] ?? null;
}

export function addPerson(
  breakdown: Breakdown,
  person: Person,
  tierMap: Record<string, Tier>
): void {
  breakdown.total++;

  const tier = tierFor(person.nationality, tierMap);
  if (tier) breakdown.tiers[tier]++;
  else breakdown.tiers.unknown++;

  // Null gender is real information (nobody filled it in), so it gets its own
  // bucket rather than being dropped from the denominator.
  const gender = person.gender?.trim().toLowerCase() || "unknown";
  breakdown.genders[gender] = (breakdown.genders[gender] ?? 0) + 1;

  const country = person.nationality?.trim();
  const countryKey = country && country.length > 0 ? country : "Unknown";
  breakdown.nationalities[countryKey] =
    (breakdown.nationalities[countryKey] ?? 0) + 1;
}

export type RankedCountry = { country: string; count: number; percent: number };

// Percentages are of the TOTAL including unknowns, so the column always sums
// to 100 and an unknown-heavy dataset looks unreliable instead of looking
// confidently wrong.
export function rankCountries(
  nationalities: Record<string, number>,
  total: number,
  limit?: number
): RankedCountry[] {
  const ranked = Object.entries(nationalities)
    .map(([country, count]) => ({
      country,
      count,
      percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

// Merge per-program breakdowns into an all-schools view.
export function combineBreakdowns(parts: Breakdown[]): Breakdown {
  const out = emptyBreakdown();
  for (const part of parts) {
    out.total += part.total;
    out.tiers.A += part.tiers.A;
    out.tiers.B += part.tiers.B;
    out.tiers.C += part.tiers.C;
    out.tiers.unknown += part.tiers.unknown;
    for (const [k, v] of Object.entries(part.genders)) {
      out.genders[k] = (out.genders[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(part.nationalities)) {
      out.nationalities[k] = (out.nationalities[k] ?? 0) + v;
    }
  }
  return out;
}
