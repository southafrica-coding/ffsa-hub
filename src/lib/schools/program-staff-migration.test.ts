import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 304 is applied by hand. These checks pin the access rules and
// the promise that applying it does not rewrite SBI (or anyone else's) rows.

const sql = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/304_program_staff.sql"),
  "utf8"
);
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 304", () => {
  it("stores staff in program_staff and does not alter program_leaders", () => {
    expect(executable).toMatch(/CREATE TABLE IF NOT EXISTS public\.program_staff/);
    expect(executable).not.toMatch(/ALTER TABLE public\.program_leaders/);
    expect(executable).not.toMatch(/UPDATE public\.program_leaders/);
    expect(executable).not.toMatch(/DELETE FROM public\.program_leaders/);
    expect(executable).not.toMatch(/UPDATE public\.user_permissions/);
    expect(executable).not.toMatch(/DELETE FROM public\.user_permissions/);
    expect(executable).not.toMatch(/INSERT INTO public\.user_permissions/);
    expect(executable).not.toMatch(/INSERT INTO public\.user_roles/);
  });

  it("does not fold staff into has_schools_access", () => {
    expect(executable).not.toMatch(/CREATE OR REPLACE FUNCTION public\.has_schools_access/);
    expect(executable).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_program_leader/);
    expect(executable).toMatch(/FUNCTION public\.is_program_staff/);
  });

  it("gates staff management on has_schools_access and blocks staff-only finance and form writes", () => {
    expect(executable).toMatch(/Manage program staff/);
    expect(executable).toMatch(/USING \(public\.has_schools_access\(program_id\)\)/);
    expect(executable).toMatch(/program_staff_blocked_from_finance/);
    expect(executable).toMatch(/Program staff cannot read student fees/);
    expect(executable).toMatch(/Program staff cannot read student payments/);
    expect(executable).toMatch(/Program staff cannot edit application questions/);
    expect(executable).toMatch(/Program staff cannot edit program emails/);
    expect(executable).toMatch(/interview_outcome IN \('pending', 'recommend', 'hold', 'decline'\)/);
  });
});
