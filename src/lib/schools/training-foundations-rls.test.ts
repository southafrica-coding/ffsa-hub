import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 334's RLS (Training: walkers, weekly check-ins, staff-only
// notes), against a throwaway database. Skips when this machine has no
// local Postgres — CI does not start one. The cloud agent run applies the
// file with psql and records the result in the PR.

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("training foundations RLS", () => {
  it("keeps staff-only notes and moods from students, program staff and outreach leaders", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "training_foundations"], {
      stdio: "pipe",
    });
    execFileSync("sudo", ["-u", "postgres", "createdb", "training_foundations"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "training_foundations",
        "-f",
        "supabase/tests/training_foundations_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
