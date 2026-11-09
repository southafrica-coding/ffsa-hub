import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

// Migration 304 is applied by hand. These checks pin the access rules and
// the promise that applying it does not rewrite SBI (or anyone else's) rows.

const sql = readFileSync(
  path.resolve(root, "supabase/migrations/304_program_staff.sql"),
  "utf8"
);
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 304", () => {
  it("stores staff in program_staff and does not change rows when the file is applied", () => {
    expect(executable).toMatch(/CREATE TABLE IF NOT EXISTS public\.program_staff/);
    expect(executable).not.toMatch(/ALTER TABLE public\.program_leaders/);
    // Deletes live inside switch/remove functions. Applying the file must not run one.
    const topLevelDeletes = executable
      .split("\n")
      .filter((line) => line.startsWith("DELETE FROM"));
    expect(topLevelDeletes).toEqual([]);
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
    expect(executable).toMatch(/ar\.program_id = application_staff_reviews\.program_id/);
    expect(executable).toMatch(/FUNCTION public\.switch_person_to_program_staff/);
    expect(executable).toMatch(/SET search_path = ''/);
    expect(executable).toMatch(/WHEN NOT EXISTS/);
  });

  it("does not change application_responses grants or sync notes back onto the column", () => {
    expect(executable).not.toMatch(/CREATE OR REPLACE FUNCTION public\.sync_admin_notes/);
    expect(executable).toMatch(/DROP FUNCTION IF EXISTS public\.sync_admin_notes_from_response/);
    expect(executable).toMatch(/ON CONFLICT \(application_response_id\) DO NOTHING/);
    expect(executable).not.toMatch(/SET admin_notes = NULL/);
    expect(executable).not.toMatch(/GRANT[^;]*application_responses/);
    expect(executable).not.toMatch(/REVOKE[^;]*application_responses/);
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.clear_program_contact_assignments\(uuid, uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(executable).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.clear_program_contact_assignments/
    );
  });

  it("keeps the column-clearing follow-up out of the numbered migrations", () => {
    const followUp = readFileSync(
      path.resolve(root, "docs/retire-application-admin-notes-column.sql"),
      "utf8"
    );
    const doc = readFileSync(path.resolve(root, "docs/program-staff.md"), "utf8");
    expect(doc).toContain(followUp.trim());
    expect(followUp).toMatch(/BEGIN;/);
    expect(followUp).toMatch(/ON CONFLICT \(application_response_id\) DO NOTHING/);
    expect(followUp).toMatch(/SET admin_notes = NULL/);
    expect(followUp).toMatch(/COMMIT;/);
    expect(sql).not.toMatch(/retire-application-admin-notes-column/);
  });
});
