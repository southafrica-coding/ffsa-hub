import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/306_leader_interview_notes.sql"),
  "utf8"
);
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 306", () => {
  it("lets a school manager write their own interview review", () => {
    expect(executable).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_application_staff_review/);
    expect(executable).toMatch(/public\.can_manage_program_applications\(v_program\)/);
    expect(executable).toMatch(/public\.is_program_staff\(v_program\)/);
    expect(executable).toMatch(/Staff or managers insert their review/);
    expect(executable).toMatch(/Staff or managers update their review/);
    expect(executable).toMatch(/ar\.program_id = claimed_program_id/);
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.application_review_write_allowed\(uuid, uuid\) FROM PUBLIC, anon/
    );
    expect(executable).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.application_review_write_allowed\(uuid, uuid\) TO authenticated, service_role/
    );
  });

  it("does not touch application status or the deprecated admin_notes column", () => {
    expect(executable).not.toMatch(/application_responses\.admin_notes/);
    expect(executable).not.toMatch(/ALTER TABLE public\.application_responses/);
    expect(executable).not.toMatch(/UPDATE public\.application_responses/);
    expect(executable).not.toMatch(/DROP COLUMN/);
    expect(executable).not.toMatch(/SET admin_notes/);
  });
});
