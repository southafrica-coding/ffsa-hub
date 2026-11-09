import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 304's RLS, against a throwaway database. Skips when this machine
// has no local Postgres — CI does not start one. The cloud agent run applies
// the file with psql and records the result in the PR.

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("program staff RLS", () => {
  it("enforces assigned reviews, and hides finance, forms, and emails from staff", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "program_staff_rls"], {
      stdio: "pipe",
    });
    execFileSync("sudo", ["-u", "postgres", "createdb", "program_staff_rls"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "program_staff_rls",
        "-f",
        "supabase/tests/program_staff_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
