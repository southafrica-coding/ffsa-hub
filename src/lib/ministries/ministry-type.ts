// How a staff ministry is classified on the Ministry tab (migration 195).
//
// Part-time ministries keep rosters, leaders, point leaders, sub-categories
// and OKRs. What they are NOT is a department: a department is the main
// ministry someone serves in, so no picker offers a part-time one and both
// profile write paths reject it. People join part-time ministries through the
// Ministry tab roster instead. Nothing about access keys off this value.

export const MINISTRY_TYPES = ["main", "part_time"] as const;

export type MinistryType = (typeof MINISTRY_TYPES)[number];

export const DEFAULT_MINISTRY_TYPE: MinistryType = "main";

export const MINISTRY_TYPE_LABELS: Record<MinistryType, string> = {
  main: "Main",
  part_time: "Part-time",
};

/** Section headings on the Ministry tab. */
export const MINISTRY_TYPE_SECTION_LABELS: Record<MinistryType, string> = {
  main: "Main ministries",
  part_time: "Part-time ministries",
};

/**
 * Narrow an untrusted value (a request body field, a DB row from an `any`
 * client) to a ministry type. Returns null when it isn't one, so callers can
 * choose between rejecting the write and falling back to the default.
 */
export function parseMinistryType(value: unknown): MinistryType | null {
  return typeof value === "string" &&
    (MINISTRY_TYPES as readonly string[]).includes(value)
    ? (value as MinistryType)
    : null;
}

/** A ministry type for display/grouping, defaulting rather than rejecting. */
export function ministryTypeOf(value: unknown): MinistryType {
  return parseMinistryType(value) ?? DEFAULT_MINISTRY_TYPE;
}
