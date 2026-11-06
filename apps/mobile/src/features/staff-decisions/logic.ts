// Pure rules for the Staff decisions screens (tested on their own). They
// mirror the web's staff-decision tab; the server checks every one again.

import type { DepartmentOption, School, SchoolDetail, StaffDecisionRow } from "./api";
import { strings } from "./strings";

const d = strings.detail;

/** Matches the web's date format: "1 Oct 2026". */
export function formatDecidedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export type DecisionWord = { label: string; tone: "positive" | "attention" | "default" };

/** "Accepted: yes" / "Accepted: no" / "Not decided", always in words. */
export function decisionWord(row: Pick<StaffDecisionRow, "decision">): DecisionWord {
  if (!row.decision) return { label: d.notDecided, tone: "default" };
  return row.decision.accepted ? { label: d.acceptedYes, tone: "positive" } : { label: d.acceptedNo, tone: "attention" };
}

export function decidedLine(row: Pick<StaffDecisionRow, "decision">): string | null {
  if (!row.decision) return null;
  return d.decidedOn(formatDecidedDate(row.decision.decidedAt), row.decision.decidedByName);
}

/** The web shows "Make staff" for a yes on file, a Hub account, and not staff yet. */
export function canMakeStaff(row: Pick<StaffDecisionRow, "decision" | "userId" | "isStaff">): boolean {
  return row.decision?.accepted === true && !!row.userId && !row.isStaff;
}

/** After saving: a yes for someone with an account who isn't staff yet goes on to the make-staff step. */
export function offerMakeStaffAfterSave(row: Pick<StaffDecisionRow, "userId" | "isStaff">, accepted: boolean): boolean {
  return accepted && !!row.userId && !row.isStaff;
}

/** Why Save can't go yet, or null. A "no" needs a note, as on the web and in the database. */
export function decisionProblem(accepted: boolean | null, note: string): string | null {
  if (accepted === null) return strings.sheet.chooseFirst;
  if (!accepted && note.trim().length === 0) return strings.sheet.noteRequired;
  return null;
}

/** Students still undecided on a school that is still running: the one yellow band. */
export function needsDecisionCount(detail: Pick<SchoolDetail, "school" | "rows">): number {
  if (detail.school.archived) return 0;
  return detail.rows.filter((r) => !r.decision).length;
}

export function departmentLabel(options: DepartmentOption[], value: string | null): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

export function schoolA11yLabel(s: School): string {
  return strings.list.rowA11y(s.name, s.archived, s.total, s.yes, s.no, s.undecided);
}

export function rowA11yLabel(row: StaffDecisionRow): string {
  return d.rowA11y({
    name: row.name,
    email: row.email,
    staff: row.isStaff,
    decision: decisionWord(row).label,
    note: row.decision?.note ?? null,
    decided: decidedLine(row),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string | undefined | null): id is string {
  return !!id && UUID.test(id);
}
