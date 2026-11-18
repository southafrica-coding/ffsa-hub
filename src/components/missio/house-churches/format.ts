import type { HouseRole, HouseSummary, PersonRef, ReviewItem } from "./types";

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

const MATCH_LABEL: Record<string, string> = {
  none: "No match found",
  multiple: "Several possible matches",
  family_label: "Family name, not one person",
  first_only: "First name only",
  partial: "Partial name",
};

const KIND_LABEL: Record<string, string> = {
  couple_split: "Couple, split into two",
  family_label: "Family name, not one person",
  first_only: "First name only",
};

export function houseTitle(house: { number: number; name: string | null }): string {
  const name = house.name?.trim() ?? "";
  return name || `House ${house.number}`;
}

export function peopleCount(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return safe === 1 ? "1 person" : `${safe} people`;
}

export function nameList(people: PersonRef[]): string {
  const names = people.map((person) => person.displayName.trim()).filter(Boolean);
  if (names.length === 0) return "No one yet";
  if (names.length === 1) return names[0] ?? "No one yet";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function meetingDayLabel(day: string | null | undefined): string {
  const trimmed = day?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function meetingLine(house: Pick<HouseSummary, "meetingDay" | "location">): string {
  const day = meetingDayLabel(house.meetingDay);
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

export function reviewHeading(item: { sourceLine: number | null; rawName: string }): string {
  return item.sourceLine == null ? item.rawName : `Line ${item.sourceLine} · ${item.rawName}`;
}

/** Kind label, then match type, without repeating the same sentence. Person and unknown kinds are omitted. */
export function reviewReasons(item: Pick<ReviewItem, "kind" | "matchType">): string[] {
  const reasons: string[] = [];
  const kind = item.kind ? KIND_LABEL[item.kind] : undefined;
  if (kind) reasons.push(kind);
  const match = item.matchType ? MATCH_LABEL[item.matchType] : undefined;
  if (match && !reasons.includes(match)) reasons.push(match);
  return reasons;
}

export function personHref(person: Pick<PersonRef, "orgPersonId">): string | null {
  const id = person.orgPersonId?.trim();
  return id ? `/missio/people/${encodeURIComponent(id)}` : null;
}
