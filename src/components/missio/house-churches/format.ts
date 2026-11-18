import type { HouseRole, HouseSummary, PersonRef, ReviewItem, ReviewMatchType } from "./types";

const ROLE_ORDER: Record<HouseRole, number> = {
  leader: 0,
  co_leader: 1,
  member: 2,
};

export const ROLE_LABEL: Record<HouseRole, string> = {
  leader: "Leader",
  co_leader: "Co-leader",
  member: "Member",
};

const MATCH_LABEL: Record<ReviewMatchType, string> = {
  none: "No match found",
  multiple: "Several possible matches",
  family_label: "Family name, not one person",
  first_only: "First name only",
  partial: "Partial name",
};

export function houseTitle(house: { number: number; name: string | null }): string {
  const name = house.name?.trim() ?? "";
  return name || `House ${house.number}`;
}

export function peopleCount(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return safe === 1 ? "1 person" : `${safe} people`;
}

/** Extra line for a match button. Only what the contact record actually has. */
export function candidateContext(person: PersonRef): string | null {
  if (person.orgPersonId) return "In the people list";
  return null;
}

export function nameList(people: PersonRef[]): string {
  const names = people.map((person) => person.displayName.trim()).filter(Boolean);
  if (names.length === 0) return "No one yet";
  if (names.length === 1) return names[0] ?? "No one yet";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function meetingLine(house: Pick<HouseSummary, "meetingDay" | "location">): string {
  const day = house.meetingDay?.trim() ?? "";
  const place = house.location?.trim() ?? "";
  if (day && place) return `${day} · ${place}`;
  return day || place;
}

export function sortHouses<T extends { number: number }>(houses: T[]): T[] {
  return houses.slice().sort((a, b) => a.number - b.number);
}

export function sortMembers<T extends { role: HouseRole; displayName: string }>(members: T[]): T[] {
  return members.slice().sort((a, b) => {
    const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (byRole !== 0) return byRole;
    return a.displayName.localeCompare(b.displayName, "en");
  });
}

/** Plain-English reasons for one review row. Family wording is not repeated. */
export function reviewReasons(item: Pick<ReviewItem, "kind" | "matchType">): string[] {
  const reasons: string[] = [];
  if (item.kind === "family_label") reasons.push(MATCH_LABEL.family_label);
  const match = MATCH_LABEL[item.matchType];
  if (match && !reasons.includes(match)) reasons.push(match);
  if (reasons.length === 0) reasons.push("Needs a decision");
  return reasons;
}

export function personHref(person: Pick<PersonRef, "orgPersonId">): string | null {
  const id = person.orgPersonId?.trim();
  return id ? `/missio/people/${encodeURIComponent(id)}` : null;
}
