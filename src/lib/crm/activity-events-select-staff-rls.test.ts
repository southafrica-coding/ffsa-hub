import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 335's RLS (activity_events readable by staff only, not by
// every signed-in user), against a throwaway database. Skips when this machine has no
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

describe.skipIf(!postgresUp())("activity_events select RLS", () => {
  it("hides contact timelines from students and keeps staff, comms and events access", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "activity_events_select_staff"], {
      stdio: "pipe",
    });
    execFileSync("sudo", ["-u", "postgres", "createdb", "activity_events_select_staff"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "activity_events_select_staff",
        "-f",
        "supabase/tests/activity_events_select_staff_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
