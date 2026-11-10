import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 305's RLS, against a throwaway database. Same pattern as
// program-staff-rls.test.ts: skips when this machine has no local Postgres
// (CI does not start one).

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("schools LMS content RLS", () => {
  it("editors see drafts, staff and enrolled students see published only, others see nothing", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "lms_content_rls"], { stdio: "pipe" });
    execFileSync("sudo", ["-u", "postgres", "createdb", "lms_content_rls"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "lms_content_rls",
        "-f",
        "supabase/tests/lms_content_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
