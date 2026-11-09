import { NextResponse } from "next/server";

export const NO_STORE = { "Cache-Control": "no-store" };

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Proposed LMS tables are not in the database yet. */
export function lmsSchemaNotApplied(feature: string) {
  return json(
    {
      error: "lms_schema_not_applied",
      message: `${feature} is not available yet.`,
    },
    503
  );
}

/**
 * Preview deployments must not write live school rows. Vercel sets
 * VERCEL_ENV to "preview" on preview URLs; production and local dev
 * (unset) keep writing. Reads are not affected.
 */
export function previewWritesDisabled() {
  if (process.env.VERCEL_ENV === "preview") {
    return json(
      {
        error: "preview_writes_disabled",
        message: "This preview deployment cannot change school records.",
      },
      403
    );
  }
  return null;
}

export function courseUnavailable() {
  return json(
    { error: "course_unavailable", message: "This course could not be loaded." },
    503
  );
}

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);
const PROPOSED = /course_design_templates|course_outlines|course_graders|grade_marks/;

export function isLmsSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_CODES.has(code)) {
    if (typeof message !== "string") return true;
    // A missing column on a table that already exists (billing_courses.graded)
    // is not the proposed LMS schema. Only the new tables count.
    if (/billing_courses|grades|enrollments|fee_charge_items|student_billing_plans/.test(message) && !PROPOSED.test(message)) {
      return false;
    }
    return true;
  }
  return typeof message === "string" && PROPOSED.test(message) && /does not exist|schema cache/i.test(message);
}

/** A missing credit_hours / graded column on the course table, after the read fallback. */
export function isCourseColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/credit_hours|\bgraded\b/.test(message)) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /does not exist|schema cache|column/i.test(message)
  );
}

/**
 * Unique violations are not all course codes. Live constraint names
 * (verified): billing_courses_program_id_code_key, grades_enrollment_id_course_id_key,
 * sbp_enrollment_course_key.
 */
export function uniqueConflictMessage(error: { message?: string; details?: string }): string {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (/billing_courses_program_id_code_key/i.test(text)) {
    return "That course code is already used in this school.";
  }
  if (/grades_enrollment_id_course_id_key/i.test(text)) {
    return "This student already has an official grade for that course.";
  }
  if (/sbp_enrollment_course_key/i.test(text)) {
    return "This student already has a billing plan for that course.";
  }
  if (/course_graders/i.test(text)) return "That grader is already assigned there.";
  if (/grade_marks/i.test(text)) return "You have already marked this student for that course.";
  return "That record already exists.";
}

/**
 * grade_marks foreign keys are ON DELETE RESTRICT. A 23503 that names that
 * table is "marks still exist", not a bad id.
 * - grader_user_id: this person still has marks (user delete / offboarding)
 * - billing_course_id: same meaning as the course-delete pre-check
 * - enrollment_id: the enrolment still has marks
 */
export function gradeMarksRestrictMessage(error: {
  code?: string;
  message?: string;
  details?: string;
}): string | null {
  if (error.code !== "23503") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!/grade_marks/i.test(text)) return null;
  if (/grader_user_id/i.test(text)) return "This person still has grader marks.";
  if (/enrollment_id/i.test(text)) {
    return "This enrolment still has grader marks. Remove them before deleting it.";
  }
  return "This course has grader marks. Remove them before deleting the course.";
}

export function dbError(
  error: { code?: string; message?: string; details?: string },
  fallback: string
) {
  if (isCourseColumnMissing(error)) return courseUnavailable();
  if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied(fallback);
  if (error.code === "23505") {
    return json({ error: "conflict", message: uniqueConflictMessage(error) }, 409);
  }
  const marks = gradeMarksRestrictMessage(error);
  if (marks) return json({ error: "conflict", message: marks }, 409);
  if (error.code === "23503") {
    return json({ error: "bad_request", message: "That link does not point at a real record." }, 400);
  }
  console.error("[lms]", fallback, error.code ?? "", error.message ?? "");
  return json({ error: "server_error", message: fallback }, 500);
}
