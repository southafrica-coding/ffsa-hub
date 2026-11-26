import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migration 354's privacy rules, against a throwaway database — same shape as
// src/lib/evangelism/rls.test.ts. Skips when this machine has no local
// Postgres (CI does not start one). Run by hand with:
//
//   dropdb --if-exists missio_care_privacy && createdb missio_care_privacy
//   psql -v ON_ERROR_STOP=1 -d missio_care_privacy -f supabase/tests/missio_care_privacy_rls.sql

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-n", "-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("missio care privacy RLS", () => {
  it("pastors see all; leaders, members and other houses see only what the person allowed", () => {
    const pg = (args: string[]) => execFileSync("sudo", ["-u", "postgres", ...args], { stdio: "pipe" });
    pg(["dropdb", "--if-exists", "missio_care_privacy"]);
    pg(["createdb", "missio_care_privacy"]);
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "missio_care_privacy", "-f", "supabase/tests/missio_care_privacy_rls.sql"],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
