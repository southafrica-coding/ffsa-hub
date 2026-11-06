import { NextResponse } from "next/server";

export const NO_STORE = { "Cache-Control": "no-store" };

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Proposed LMS tables are not in the database. Hub Data applies them. */
export function lmsSchemaNotApplied(feature: string) {
  return json(
    {
      error: "lms_schema_not_applied",
      message: `${feature} needs tables Hub Data has not applied yet. Do not apply them until Hub Data and Jack approve the proposal.`,
    },
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

export function dbError(error: { code?: string; message?: string }, fallback: string) {
  if (isLmsSchemaMissing(error)) return lmsSchemaNotApplied(fallback);
  if (error.code === "23505") {
    return json({ error: "conflict", message: "That code is already used in this school." }, 409);
  }
  if (error.code === "23503") {
    return json({ error: "bad_request", message: "That link does not point at a real record." }, 400);
  }
  console.error("[lms]", fallback, error.code ?? "", error.message ?? "");
  return json({ error: "server_error", message: fallback }, 500);
}
