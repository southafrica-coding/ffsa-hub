import type { MissioPersonFamily } from "@/lib/missio/types";

// Family copy for the People list and the household card. Pure: no reads,
// safe in client components.
//
// Children keep a birth year only (migration 341, POPIA). Age is the
// calendar year in Johannesburg minus that year: a one-year band, never a
// birthday, and it may be a year ahead of their real age until their
// birthday.

const ZONE = "Africa/Johannesburg";

/** The calendar year right now in Johannesburg. */
export function johannesburgYear(now: Date = new Date()): number {
  const year = new Intl.DateTimeFormat("en-ZA", { timeZone: ZONE, year: "numeric" }).format(now);
  const parsed = Number(year.replace(/\D/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : now.getUTCFullYear();
}

/** Age from a birth year, or null when there's no year or it's in the future. */
export function ageFromBirthYear(birthYear: number | null | undefined, now: Date = new Date()): number | null {
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear) || birthYear <= 0) return null;
  const age = johannesburgYear(now) - birthYear;
  return age >= 0 ? age : null;
}

/** "7" on the list; "under 1" for a child born this year. */
export function shortAge(age: number): string {
  return age < 1 ? "under 1" : String(age);
}

/** "7 years old" on the household card. */
export function ageWords(age: number): string {
  if (age < 1) return "Under 1 year old";
  return `${age} ${age === 1 ? "year" : "years"} old`;
}

/** "Maya, 7", or "Maya" without a year. */
export function childPhrase(child: { firstName: string; age: number | null }): string {
  const name = child.firstName.trim();
  return child.age === null ? name : `${name}, ${shortAge(child.age)}`;
}

/**
 * "Maya, 7 and Daniel, 4". Three or more use semicolons between children so
 * the ages don't read as names: "Maya, 7; Daniel, 4 and Sam, 2".
 */
export function childrenPhrase(children: Array<{ firstName: string; age: number | null }>): string {
  const parts = children.filter((child) => child.firstName.trim()).map(childPhrase);
  if (parts.length <= 1) return parts.join("");
  const hasAges = children.some((child) => child.age !== null);
  const sep = parts.length > 2 && hasAges ? "; " : ", ";
  return `${parts.slice(0, -1).join(sep)} and ${parts[parts.length - 1]}`;
}

/** "With Esther · mom", "With Esther · mom and Ben". */
function othersPhrase(others: NonNullable<MissioPersonFamily["otherAdults"]>): string {
  const parts = others
    .filter((adult) => adult.firstName.trim())
    .map((adult) => (adult.label?.trim() ? `${adult.firstName.trim()} (${adult.label.trim()})` : adult.firstName.trim()));
  if (parts.length === 0) return "";
  if (parts.length === 1 && others.length === 1 && others[0]!.label?.trim()) {
    return `With ${others[0]!.firstName.trim()} · ${others[0]!.label!.trim()}`;
  }
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `With ${list}`;
}

/**
 * The quiet family line under a name on People:
 * "Married to Johan · Maya, 7 and Daniel, 4". Empty when there's nothing to
 * say (a household of one with no children), so no line is drawn.
 */
export function familyLine(family: MissioPersonFamily | undefined): string {
  if (!family) return "";
  const parts: string[] = [];
  if (family.spouse?.firstName.trim()) parts.push(`Married to ${family.spouse.firstName.trim()}`);
  else if (family.otherAdults?.length) {
    const others = othersPhrase(family.otherAdults);
    if (others) parts.push(others);
  }
  const kids = childrenPhrase(family.children);
  if (kids) parts.push(kids);
  return parts.join(" · ");
}

/**
 * Household labels that clearly aren't a spouse. If either of two adults
 * carries one, the list says "With …" rather than "Married to …". Anything
 * else (blank, "Husband", "wife", "partner", free text) stays "Married to".
 */
const NOT_SPOUSE = new Set([
  "mom", "mum", "mother", "ma", "dad", "father", "pa", "parent",
  "son", "daughter", "child", "kid",
  "brother", "sister", "sibling",
  "grandmother", "grandfather", "grandma", "grandpa", "gran", "granny", "ouma", "oupa", "grandparent",
  "aunt", "auntie", "uncle", "cousin", "niece", "nephew",
  "mother-in-law", "father-in-law", "son-in-law", "daughter-in-law", "brother-in-law", "sister-in-law", "in-law",
  "friend", "housemate", "flatmate", "roommate", "lodger", "tenant", "carer", "caregiver", "guardian",
]);

export function isNotSpouseLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const key = label.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (NOT_SPOUSE.has(key)) return true;
  // "mom of Esther", "Johan's mom", "step-dad"
  return key.split(/[\s']+/).some((word) => NOT_SPOUSE.has(word.replace(/^step-?/, "")));
}
