// Which staff_ministries.slug values are department homes.
// Lookups use the slug column as stored. There is no hyphenated alias.

export const LEADERSHIP_TEAM_SLUG = "leadership_team";
export const FINANCES_LEGAL_SLUG = "finances_legal";

/**
 * Never a department home. Real staff_ministries.slug values:
 * no_ministry (206), hope_again (195, the part-time staff ministry),
 * be_free (317), rooted_christian_academy and woven (250).
 * Brave Love, Watchmen and Old Age Home are OKR teams in 182
 * (brave_love, the_watchmen, old_age_homes). Those slugs are listed too
 * so a staff row with the same slug still 404s. watchmen and old_age_home
 * are the other spellings Hub UI already refuses.
 */
export const NOT_A_HOME_SLUGS = [
  "no_ministry",
  "hope_again",
  "be_free",
  "brave_love",
  "the_watchmen",
  "watchmen",
  "old_age_home",
  "old_age_homes",
  "rooted_christian_academy",
  "woven",
] as const;

/** donors_dev opens the finances_legal home. No other child is folded. */
export const FOLDED_DEPARTMENTS = {
  donors_dev: FINANCES_LEGAL_SLUG,
} as const;

const BLOCKED = new Set<string>(NOT_A_HOME_SLUGS);

export function isBlockedHomeSlug(slug: string): boolean {
  return BLOCKED.has(slug);
}

export function foldedTargetSlug(slug: string): string | null {
  if (slug in FOLDED_DEPARTMENTS) {
    return FOLDED_DEPARTMENTS[slug as keyof typeof FOLDED_DEPARTMENTS];
  }
  return null;
}
