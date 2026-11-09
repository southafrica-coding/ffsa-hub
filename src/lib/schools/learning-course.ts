// Training-admin course shell. These rows are billing_courses (migration 098,
// grades re-pointed in 179). The academic `courses` table is unused.
// This parser does not accept fee items — finance keeps those.

const CODE = /^[A-Za-z0-9]{2,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["upcoming", "active", "completed", "archived"] as const;
const SCOPES = ["full_program", "segment"] as const;

const FIELDS = [
  "code",
  "name",
  "description",
  "scope",
  "sequence",
  "start_date",
  "end_date",
  "arrival_date",
  "credit_hours",
  "graded",
  "notes",
  "lead_staff_id",
  "status",
] as const;

export type LearningCourseField = (typeof FIELDS)[number];

export function parseLearningCourse(
  input: Record<string, unknown>,
  mode: "create" | "patch"
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const value: Record<string, unknown> = {};
  const present = FIELDS.filter((field) => field in input);
  if (mode === "patch" && present.length === 0) {
    return { ok: false, message: "Nothing to update." };
  }

  if (mode === "create" || "code" in input) {
    const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
    if (!CODE.test(code)) return { ok: false, message: "Course code must be 2–16 letters or numbers." };
    value.code = code;
  }
  if (mode === "create" || "name" in input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2 || name.length > 120) return { ok: false, message: "Course name must be 2–120 characters." };
    value.name = name;
  }

  const text = (field: "description" | "notes", max: number) => {
    if (!(field in input)) return true;
    if (input[field] === null || input[field] === "") {
      value[field] = null;
      return true;
    }
    if (typeof input[field] !== "string" || (input[field] as string).trim().length > max) {
      return false;
    }
    value[field] = (input[field] as string).trim();
    return true;
  };
  if (!text("description", 4000)) return { ok: false, message: "Description must be under 4000 characters." };
  if (!text("notes", 2000)) return { ok: false, message: "Notes must be under 2000 characters." };

  if ("scope" in input) {
    if (!SCOPES.includes(input.scope as (typeof SCOPES)[number])) {
      return { ok: false, message: "Scope must be full_program or segment." };
    }
    value.scope = input.scope;
  }
  if ("status" in input) {
    if (!STATUSES.includes(input.status as (typeof STATUSES)[number])) {
      return { ok: false, message: "Status must be upcoming, active, completed, or archived." };
    }
    value.status = input.status;
  }
  if ("sequence" in input) {
    if (!isInt(input.sequence, 0, 999)) return { ok: false, message: "Sequence must be a whole number from 0 to 999." };
    value.sequence = input.sequence;
  }
  if ("credit_hours" in input) {
    if (!isInt(input.credit_hours, 0, 40)) return { ok: false, message: "Credit hours must be a whole number from 0 to 40." };
    value.credit_hours = input.credit_hours;
  }
  if ("graded" in input) {
    if (typeof input.graded !== "boolean") return { ok: false, message: "Graded must be true or false." };
    value.graded = input.graded;
  }
  if ("lead_staff_id" in input) {
    if (input.lead_staff_id === null || input.lead_staff_id === "") value.lead_staff_id = null;
    else if (typeof input.lead_staff_id !== "string" || !UUID.test(input.lead_staff_id)) {
      return { ok: false, message: "Lead staff must be a user id." };
    } else value.lead_staff_id = input.lead_staff_id;
  }

  for (const field of ["start_date", "end_date", "arrival_date"] as const) {
    if (!(field in input)) continue;
    if (input[field] === null || input[field] === "") {
      value[field] = null;
      continue;
    }
    if (typeof input[field] !== "string" || !DATE.test(input[field] as string)) {
      return { ok: false, message: `${field} must be YYYY-MM-DD.` };
    }
    value[field] = input[field];
  }

  return { ok: true, value };
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function datesAreOrdered(dates: {
  start_date?: string | null;
  end_date?: string | null;
  arrival_date?: string | null;
}): string | null {
  if (dates.start_date && dates.end_date && dates.end_date < dates.start_date) {
    return "The end date cannot be before the start date.";
  }
  if (dates.arrival_date && dates.start_date && dates.arrival_date > dates.start_date) {
    return "Arrival cannot be after the course starts.";
  }
  return null;
}

/** Why a course shell cannot be removed. Finance, transcript, and grader marks win. */
export function learningCourseDeleteBlock(counts: {
  charges: number;
  plans: number;
  grades: number;
  marks: number;
}): string | null {
  if (counts.charges > 0) {
    return "This course has fee items. Those have to be removed before the course can be deleted.";
  }
  if (counts.plans > 0) return "Students already have billing plans on this course.";
  if (counts.grades > 0) return "This course has grades on the transcript. It cannot be deleted.";
  if (counts.marks > 0) return "This course has grader marks. Remove them before deleting the course.";
  return null;
}

/** Fields that must stay put once the course has fees or transcript grades. */
export const LOCKED_WHEN_IN_USE = ["code", "start_date", "end_date", "arrival_date", "graded"] as const;

/** Fields that show on a transcript. Successful changes are written to the audit log. */
export const TRANSCRIPT_FIELDS = ["code", "name", "credit_hours", "graded"] as const;

function sameValue(before: unknown, after: unknown): boolean {
  if (before == null && after == null) return true;
  if (typeof before === "string" && typeof after === "string") {
    const left = /^\d{4}-\d{2}-\d{2}/.test(before) ? before.slice(0, 10) : before;
    const right = /^\d{4}-\d{2}-\d{2}/.test(after) ? after.slice(0, 10) : after;
    return left === right;
  }
  return before === after;
}

export function lockedFieldChanges(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): string[] {
  return LOCKED_WHEN_IN_USE.filter(
    (field) => field in patch && !sameValue(existing[field], patch[field])
  );
}

export function transcriptFieldChanges(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of TRANSCRIPT_FIELDS) {
    if (!(field in patch) || sameValue(existing[field], patch[field])) continue;
    changes[field] = { from: existing[field] ?? null, to: patch[field] };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * A grader has to be staff (or another elevated role), not a student-only
 * account. Same membership set as src/lib/auth/membership-roles.ts:
 * student, community_member, self_service are not enough on their own.
 * Staff who also hold the student role still qualify.
 */
const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);

export function canBeCourseGrader(roleNames: string[]): boolean {
  return roleNames.some((name) => !MEMBERSHIP_ONLY.has(name));
}

/** Removed from the roster, or marked withdrawn. */
export function enrollmentIsClosed(row: {
  removed_at?: string | null;
  status?: string | null;
}): boolean {
  return row.removed_at != null || row.status === "withdrawn";
}
