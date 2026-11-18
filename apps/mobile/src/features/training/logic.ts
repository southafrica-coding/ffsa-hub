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
