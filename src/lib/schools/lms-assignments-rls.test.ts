import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "vitest";

// Migration 310's RLS, triggers and storage policies, against a throwaway
// database. Same pattern as program-staff-rls.test.ts (sudo -u postgres on
// the cloud agent box). On a developer machine it also runs against a
// local throwaway server when LMS_RLS_PGPORT is set, e.g.
//   LMS_RLS_PGPORT=54329 PG_BIN=/opt/homebrew/opt/postgresql@16/bin npx vitest run lms-assignments-rls
// Skips when neither is available (CI does not start Postgres). Never
// point this at a shared or remote database: it drops and recreates
// lms_assignments_rls on the server it is given.

const DB = "lms_assignments_rls";
const SQL = "supabase/tests/lms_assignments_rls.sql";

type Runner = (bin: string, args: string[]) => void;

function sudoRunner(): Runner | null {
  try {
    execFileSync("sudo", ["-n", "-u", "postgres", "pg_isready", "-q"], { stdio: "ignore" });
    return (bin, args) => execFileSync("sudo", ["-u", "postgres", bin, ...args], { stdio: "pipe", cwd: process.cwd() });
  } catch {
    return null;
  }
}

function localRunner(): Runner | null {
  const port = process.env.LMS_RLS_PGPORT;
  if (!port) return null;
  const host = process.env.LMS_RLS_PGHOST ?? "localhost";
  if (host !== "localhost" && host !== "127.0.0.1") return null; // local only
  const bin = process.env.PG_BIN ?? "";
  const env = { ...process.env, PGHOST: host, PGPORT: port, PGUSER: process.env.LMS_RLS_PGUSER ?? "postgres" };
  try {
    execFileSync(path.join(bin, "pg_isready"), ["-q"], { stdio: "ignore", env });
    return (cmd, args) => execFileSync(path.join(bin, cmd), args, { stdio: "pipe", cwd: process.cwd(), env });
  } catch {
    return null;
  }
}

const run = sudoRunner() ?? localRunner();

describe.skipIf(!run)("schools LMS assignments RLS (migration 310)", () => {
  it("every role: a PASS case and a deliberate FAIL case on every table and on storage objects", () => {
    run!("dropdb", ["--if-exists", DB]);
    run!("createdb", [DB]);
    run!("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", SQL]);
  }, 120_000);
});
