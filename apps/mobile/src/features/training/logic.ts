// Who gets the Training tab, and which sections it shows (redesign 48i).
// UX ONLY: RLS (migration 334 and earlier schools policies) decides what
// any screen can read. Imports only the shell's access helpers so the tab
// list (shell/tabs.ts) can use it without an import cycle.

import { hasRole, isAdmin } from "@/features/shell/access";
import type { Me } from "@/lib/api";

export type TrainingRole = "director" | "leader" | "staff" | "walker";

export type SectionId = "today" | "schools" | "applicants" | "people" | "students" | "myStudents" | "grades";

/** The sections each role sees in the top switcher, in order (48a / 48i). */
export const SECTIONS: Record<TrainingRole, readonly SectionId[]> = {
  director: ["today", "schools", "applicants", "people"],
  leader: ["today", "students", "applicants", "grades"],
  staff: ["today", "students", "grades"],
  walker: ["today", "myStudents", "grades"],
};

/** Holds the web's Training module: admins, program leaders, or any schools.* permission (same rule as My Schools). */
export function hasTrainingModule(me: Me | null): boolean {
  if (!me) return false;
  return isAdmin(me) || hasRole(me, "program_leader") || me.permissions.some((p) => p.key.startsWith("schools."));
}

/** Training director: an admin, or schools.manage with no scope (every school). */
export function isTrainingDirector(me: Me | null): boolean {
  if (!me) return false;
  return isAdmin(me) || me.permissions.some((p) => p.key === "schools.manage" && !p.scopeType);
}

function walkingWith(me: Me | null): number {
  return me?.training?.walkingWith ?? 0;
}

function programStaff(me: Me | null): number {
  return me?.training?.programStaff ?? 0;
}

/** The strongest Training role this person holds, or null for none. */
export function trainingRole(me: Me | null): TrainingRole | null {
  if (!me) return null;
  if (isTrainingDirector(me)) return "director";
  if (hasTrainingModule(me)) return "leader";
  if (programStaff(me) > 0) return "staff";
  if (walkingWith(me) > 0) return "walker";
  return null;
}

/** Shows the Training tab: the Training module, named program staff, or walking with a student. */
export function hasTrainingAccess(me: Me | null): boolean {
  return trainingRole(me) !== null;
}

export function sectionsFor(me: Me | null): readonly SectionId[] {
  const role = trainingRole(me);
  return role ? SECTIONS[role] : [];
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "MON 23 NOV", in the phone's own time zone. */
export function dayLabel(now: Date): string {
  return `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-23" or an ISO timestamp -> "23 Nov" (date part as written, no time-zone shift). */
export function shortDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1] ?? ""}`.trim();
}

export type StudentFilter = "all" | "needs_care" | "no_checkin";

/** Filter the list; walkers ("My students") see only the people they walk with. */
export function filterStudents<T extends { status: string; walkingWithMe: boolean }>(
  students: readonly T[],
  filter: StudentFilter,
  onlyMine: boolean,
): T[] {
  return students.filter((s) => (!onlyMine || s.walkingWithMe) && (filter === "all" || s.status === filter));
}
