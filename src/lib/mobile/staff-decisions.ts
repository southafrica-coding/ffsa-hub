// ============================================================
// /api/mobile/staff-decisions/** — response contract
// ============================================================
// The phone app's mirror of the website's Leadership Track staff decisions
// (src/app/(admin)/staff-decisions/page.tsx and the staff_decision tab of
// src/app/(admin)/schools/[programId]/page.tsx). Those pages read with the
// service-role client after canUseStaffDecisions(); the phone must never hold
// that key, so the mobile endpoints run the same check on the server and
// only then read with the admin client, through the same lib functions.
//
// Role-only, like ROLE_ONLY_MODULES on the web: Leadership Team or
// super_admin. Being a plain admin is NOT enough.
//
// Writes are not here: the phone calls the website's own
// POST /api/schools/staff-decisions and /make-staff, which check again.
// ============================================================

import { z } from "zod";
import type { StaffDecisionRow } from "@/lib/schools/staff-decisions";

export const NO_STORE = { "Cache-Control": "no-store" };

export const programIdSchema = z.string().uuid();

export type DecisionCounts = { total: number; yes: number; no: number; undecided: number };

/** Same counting as the web list page and tab header. */
export function countDecisions(rows: Pick<StaffDecisionRow, "decision">[]): DecisionCounts {
  const yes = rows.filter((r) => r.decision?.accepted === true).length;
  const no = rows.filter((r) => r.decision?.accepted === false).length;
  return { total: rows.length, yes, no, undecided: rows.length - yes - no };
}

export type StaffDecisionSchool = DecisionCounts & {
  id: string;
  name: string;
  status: string;
  archived: boolean;
};

export function shapeSchool(
  program: { id: string; name: string; status: string },
  rows: Pick<StaffDecisionRow, "decision">[]
): StaffDecisionSchool {
  return {
    id: program.id,
    name: program.name,
    status: program.status,
    archived: program.status === "archived",
    ...countDecisions(rows),
  };
}

/** Newest first, the way the web list sorts (name descending). */
export function sortSchools(schools: StaffDecisionSchool[]): StaffDecisionSchool[] {
  return [...schools].sort((a, b) => b.name.localeCompare(a.name));
}

export function shapeDepartmentOptions(
  ministries: Array<{ slug: string; name: string }> | null | undefined
): Array<{ value: string; label: string }> {
  return (ministries ?? []).map((m) => ({ value: m.slug, label: m.name }));
}
