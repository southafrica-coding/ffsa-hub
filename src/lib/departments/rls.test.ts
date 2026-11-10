import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migrations 317–320 against a throwaway database. Skips when this machine
// has no local Postgres — CI does not start one. The SQL file builds its
// own stub of the tables those migrations touch and applies them twice.

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("departments and services RLS", () => {
  it("folds donors, links Be Free, and enforces rock, budget and service access", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "departments_services_rls"], {
      stdio: "pipe",
    });
    execFileSync("sudo", ["-u", "postgres", "createdb", "departments_services_rls"], {
      stdio: "pipe",
    });
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "departments_services_rls",
        "-f",
        "supabase/tests/departments_services_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 120_000);
});
