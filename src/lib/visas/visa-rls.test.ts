import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Migrations 360–366 (RLS, workflow functions and letters), against throwaway databases. Same pattern as
// src/lib/schools/program-staff-rls.test.ts: skips when this machine has no
// local Postgres (CI does not start one).

function postgresUp(): boolean {
  try {
    execFileSync("sudo", ["-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!postgresUp())("visa RLS", () => {
  it("legal sees everything, leaders their schools' cases, students their own, others nothing", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "visa_rls"], { stdio: "pipe" });
    execFileSync("sudo", ["-u", "postgres", "createdb", "visa_rls"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "visa_rls", "-f", "supabase/tests/visa_rls.sql"],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);

  it("walks a case from upload to arrival; every wrong-person move is refused", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "visa_workflow"], { stdio: "pipe" });
    execFileSync("sudo", ["-u", "postgres", "createdb", "visa_workflow"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "visa_workflow", "-f", "supabase/tests/visa_workflow.sql"],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);

  it("letters: versioned templates, issue, the student's check, the signed scan; no passport numbers stored", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "visa_letters"], { stdio: "pipe" });
    execFileSync("sudo", ["-u", "postgres", "createdb", "visa_letters"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "visa_letters", "-f", "supabase/tests/visa_letters.sql"],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);

  it("embassies and FFSA's standing documents: who keeps them, who picks the embassy, what students download", () => {
    execFileSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", "visa_embassies"], { stdio: "pipe" });
    execFileSync("sudo", ["-u", "postgres", "createdb", "visa_embassies"], { stdio: "pipe" });
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "visa_embassies", "-f", "supabase/tests/visa_embassies.sql"],
      { stdio: "pipe", cwd: process.cwd() }
    );
  }, 60_000);
});
