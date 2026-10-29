// ────────────────────────────────────────────────────────────
// MARITAL STATUS → WHICH FAMILY QUESTIONS APPLY
// ────────────────────────────────────────────────────────────
// One rule, used by the onboarding wizard, the staff family gate, the
// profile household editor and the household API, so the screens and the
// server can never disagree about who is asked what.
//
//   married                     → spouse + children
//   single / divorced / widowed → children only (there is no current
//                                 spouse, but single parents exist, so
//                                 everyone is asked about children)
//   blank / unknown             → both. Legacy rows predate the rule (and the
//                        profile gate collects marital status before the
//                        family gate runs), so keep the old behaviour
//                        rather than silently hide family records.

export const MARITAL_STATUS_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
] as const;

export type MaritalStatus = (typeof MARITAL_STATUS_OPTIONS)[number]["value"];

const KNOWN = new Set<string>(MARITAL_STATUS_OPTIONS.map((o) => o.value));

// A known status, or null for blank / anything off-list.
export function normalizeMaritalStatus(value: unknown): MaritalStatus | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return KNOWN.has(v) ? (v as MaritalStatus) : null;
}

export type FamilyQuestions = { spouse: boolean; children: boolean };

export function familyQuestionsFor(status: unknown): FamilyQuestions {
  switch (normalizeMaritalStatus(status)) {
    case "married":
      return { spouse: true, children: true };
    case "single":
    case "divorced":
    case "widowed":
      return { spouse: false, children: true };
    default:
      return { spouse: true, children: true };
  }
}

// Whether a spouse record may be stored for someone with this status.
export function canHaveSpouse(status: unknown): boolean {
  return familyQuestionsFor(status).spouse;
}

// The household relationships the add buttons should offer. "dependent"
// has no add button today, so only spouse / child are listed.
export function addableRelationships(status: unknown): string[] {
  const q = familyQuestionsFor(status);
  return [...(q.spouse ? ["spouse"] : []), ...(q.children ? ["child"] : [])];
}

// Server-side check for a household write. Returns a human error message
// when the relationship doesn't fit the person's marital status, or null.
// Only a spouse is refused: children / dependents are always accepted,
// whatever the status.
export function householdRelationshipError(
  relationship: unknown,
  maritalStatus: unknown
): string | null {
  if (relationship !== "spouse") return null;
  if (canHaveSpouse(maritalStatus)) return null;
  const status = normalizeMaritalStatus(maritalStatus);
  return `Your marital status is set to ${status ?? "something other than married"}, so a spouse can't be added. If that's changed, update your marital status on your profile first.`;
}

// What the staff family gate should ask. `hasChildren` is the household's
// stored answer (null = never asked). Every listed status is asked about
// children; the hasChildren check keeps that true even if a future status
// isn't — someone who already said "yes" has records that exist.
export function familyGatePlan(
  status: unknown,
  hasChildren: boolean | null
): { askSpouse: boolean; askChildren: boolean } {
  const q = familyQuestionsFor(status);
  return {
    askSpouse: q.spouse,
    askChildren: q.children || hasChildren === true,
  };
}
