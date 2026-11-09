import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 307's RLS, against a throwaway database — same shape as
// src/lib/schools/program-staff-rls.test.ts. Skips when this machine has no
// local Postgres (CI does not start one). Run by hand with:
//
//   dropdb --if-exists evangelism_rls && createdb evangelism_rls
//   psql -v ON_ERROR_STOP=1 -d evangelism_rls -f supabase/tests/evangelism_testimonies_rls.sql

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-n", "-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("evangelism testimonies RLS", () => {
  it("enforces view / submit / publish across every status", () => {
    const pg = (args: string[]) => execFileSync("sudo", ["-u", "postgres", ...args], { stdio: "pipe" });
    pg(["dropdb", "--if-exists", "evangelism_rls"]);
    pg(["createdb", "evangelism_rls"]);
    execFileSync(
      "sudo",
      [
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "evangelism_rls",
        "-f",
        "supabase/tests/evangelism_testimonies_rls.sql",
      ],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
