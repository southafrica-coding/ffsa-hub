// Pure helpers for the Ministries screens (unit-tested in
// __tests__/logic.test.ts). The grouping and ranking mirror the website's
// /ministry and /ministry/[id] pages so the phone and the web read the same.

import { hasRole, isAdmin } from "@/features/shell/access";
import type { Me } from "@/lib/api";

import type { MinistryDetail, MinistryListItem, RosterMember } from "./api";
import { strings } from "./strings";

// ── Who may open Ministries (UX only: the server decides) ──────────────────

export type MinistriesAccess = "checking" | "allowed" | "notAllowed" | "unknown";

/** Admins and Leadership Team always see every ministry: no need to ask. */
export function seesAllFromMe(me: Me | null): boolean {
  return isAdmin(me) || hasRole(me, "leadership_team");
}

/**
 * Combines /api/me with the access probe's answer (fresh or remembered).
 * `probe` is true / false, null when it couldn't be read, undefined while waiting.
 */
export function ministriesAccess({
  me,
  meLoading,
  probe,
}: {
  me: Me | null;
  meLoading: boolean;
  probe: boolean | null | undefined;
}): MinistriesAccess {
  if (seesAllFromMe(me) || probe === true) return "allowed";
  if (probe === undefined || meLoading) return "checking";
  return probe === false ? "notAllowed" : "unknown";
}

// ── List ────────────────────────────────────────────────────────────────────

export type MinistrySection = { type: "main" | "part_time"; label: string; items: MinistryListItem[] };

const SECTION_LABELS = { main: "Main ministries", part_time: "Part-time ministries" } as const;

/**
 * Main / Part-time sections in the server's order. A section with nothing
 * in it is left out; `showHeadings` is false when there's only one, so the
 * common case reads as one plain list (as on the web).
 */
export function listSections(items: MinistryListItem[]): { sections: MinistrySection[]; showHeadings: boolean } {
  const sections = (["main", "part_time"] as const)
    .map((type) => ({ type, label: SECTION_LABELS[type], items: items.filter((m) => m.ministryType === type) }))
    .filter((s) => s.items.length > 0);
  return { sections, showHeadings: sections.length > 1 };
}

// ── Team ────────────────────────────────────────────────────────────────────

export const UNCATEGORIZED = "__none__";

export type RosterGroup = { key: string; label: string; rows: RosterMember[] };

/** Point leader of this category: someone can lead one category and not another. */
export function leadsCategory(r: RosterMember, groupKey: string): boolean {
  return groupKey !== UNCATEGORIZED && r.pointLeaderCategoryIds.includes(groupKey);
}

function rankOf(r: RosterMember, groupKey: string): number {
  if (r.isPointLeader) return 0;
  if (leadsCategory(r, groupKey)) return 1;
  return r.role === "leader" ? 2 : 3;
}

function sortForGroup(rows: RosterMember[], groupKey: string): RosterMember[] {
  return [...rows].sort((a, b) => rankOf(a, groupKey) - rankOf(b, groupKey) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * The team grouped by sub-category, like the web: one group per category in
 * order (empty ones too, so leaders see the group exists), then
 * "Uncategorized", which is left out when empty. Someone in several
 * categories appears in each. With no categories at all there's one group
 * with no label.
 */
export function rosterGroups(detail: Pick<MinistryDetail, "roster" | "subcategories">): RosterGroup[] {
  const { roster, subcategories } = detail;
  const groups: RosterGroup[] = subcategories.map((c) => ({
    key: c.id,
    label: c.name,
    rows: sortForGroup(
      roster.filter((r) => r.categoryIds.includes(c.id)),
      c.id,
    ),
  }));
  const rest = sortForGroup(
    roster.filter((r) => r.categoryIds.length === 0),
    UNCATEGORIZED,
  );
  if (rest.length > 0 || subcategories.length === 0) {
    groups.push({ key: UNCATEGORIZED, label: subcategories.length > 0 ? strings.detail.uncategorized : "", rows: rest });
  }
  return groups;
}

/** The words shown next to a name, in the web's order. Never colour alone. */
export function memberBadges(r: RosterMember, groupKey: string): string[] {
  const out: string[] = [];
  const categoryLead = leadsCategory(r, groupKey);
  if (r.isPointLeader) out.push(strings.detail.pointLeader);
  if (categoryLead) out.push(strings.detail.categoryLead);
  if (r.role === "leader" && !r.isPointLeader && !categoryLead) out.push(strings.detail.leader);
  if (r.status === "pending") out.push(strings.detail.pending);
  return out;
}

/** What a screen reader says for one person on the team. */
export function memberA11yLabel(r: RosterMember, groupKey: string): string {
  const badges = memberBadges(r, groupKey);
  const role = badges.length > 0 ? badges : [strings.detail.member];
  return [r.name, ...role, r.email].filter(Boolean).join(". ");
}

/** Pending people, once each (they can sit in several categories). */
export function pendingMembers(roster: RosterMember[]): RosterMember[] {
  const seen = new Set<string>();
  return roster.filter((r) => r.status === "pending" && !seen.has(r.membershipId) && (seen.add(r.membershipId), true));
}

/** Masthead context line: "Main ministry · Retired". */
export function detailContext(m: MinistryDetail["ministry"]): string {
  return [strings.detail.contextType[m.ministryType] ?? strings.detail.contextType.main, m.isActive ? null : strings.detail.retired]
    .filter(Boolean)
    .join(" · ");
}

/** Route ids are ministry uuids; anything else is "not found" without asking. */
export function isUuid(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
