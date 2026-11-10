/**
 * Department homes, one constant.
 * Values are `staff_ministries.slug` exactly. Change this list to add or
 * drop a home.
 */
export const DEPARTMENT_HOME_SLUGS = [
  "leadership_team",
  "prayer_and_worship",
  "training",
  "education",
  "hulk",
  "project_54",
  "1040",
  "events",
  "operations",
  "finances_legal",
  "media",
  "missio_ministry",
] as const;

/**
 * Explicit folds only. A child ministry is not folded just because it has
 * a parent: `education` keeps its own home, and `rooted_christian_academy`
 * 404s. When the row has `parent_id`, that slug wins over this fallback.
 */
export const FOLDED_INTO = {
  donors_dev: "finances_legal",
} as const;

/** Live slugs that are not homes. `donors_dev` redirects; the rest 404. */
export const NON_HOME_SLUGS = [
  "brave_love",
  "hope_again",
  "watchmen",
  "old_age_home",
  "rooted_christian_academy",
  "no_ministry",
  "inside_ministry",
  "outside_ministry",
  "woven",
] as const;
