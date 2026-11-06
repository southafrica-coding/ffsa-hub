import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 292 is applied by hand in the Supabase SQL editor, so nothing
// runs it in CI. These checks read the SQL and pin down what matters for
// access: school leaders get bookings.request and nothing more, the backfill
// draws from program_leaders, and nobody is handed the program_leader role
// (an unscoped program_leader is a global schools manager).

const DIR = path.resolve(__dirname, "../../../supabase/migrations");
const raw = readFileSync(
  path.join(DIR, "292_school_leaders_request_space_bookings.sql"),
  "utf8"
);
// Executable SQL only — the verify / rollback blocks are comments.
const sql = raw
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

// Statements end with ";" at end of line (a role description has one inline).
const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter(Boolean);
const into = (table: string) =>
  statements.filter((s) => s.startsWith(`INSERT INTO public.${table}`));

describe("migration 292 — bundles", () => {
  it("creates the school_leader role, non-system, idempotently", () => {
    const [role] = into("roles");
    expect(role).toMatch(/'school_leader'/);
    expect(role).toMatch(/false\s*\)\s*ON CONFLICT \(name\) DO NOTHING$/);
  });

  it("grants bookings.request to school_leader and program_leader — and nothing else", () => {
    const bundles = into("role_permissions");
    expect(bundles).toHaveLength(1);
    const [b] = bundles;
    expect(b).toMatch(/p\.key = 'bookings\.request'/);
    expect(b).not.toMatch(/p\.key IN/);
    expect(b).toMatch(/r\.name IN \('school_leader', 'program_leader'\)/);
    expect(b).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING$/);
  });
});

describe("migration 292 — backfill", () => {
  const assigns = into("user_roles");

  it("has exactly one user_roles insert", () => {
    expect(assigns).toHaveLength(1);
  });

  const [backfill] = assigns;

  it("assigns school_leader, never program_leader", () => {
    expect(backfill).toMatch(/JOIN public\.roles r ON r\.name = 'school_leader'/);
    expect(sql).not.toMatch(/user_roles[\s\S]*'program_leader'[\s\S]*FROM public\.program_leaders/);
  });

  it("draws one row per distinct user in program_leaders", () => {
    expect(backfill).toMatch(/SELECT DISTINCT pl\.user_id, r\.id, NULL::uuid/);
    expect(backfill).toMatch(/FROM public\.program_leaders pl/);
  });

  it("is global (unscoped) with assigned_by NULL", () => {
    expect(backfill).toMatch(/\(user_id, role_id, assigned_by\)/);
    expect(backfill).not.toMatch(/scope_type,|scope_id,/);
  });

  it("skips people who already hold the unscoped role, so re-runs add nothing", () => {
    expect(backfill).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.user_roles ur\s*WHERE ur\.user_id = pl\.user_id\s*AND ur\.role_id = r\.id\s*AND ur\.scope_type IS NULL\s*\)$/
    );
  });

  it("changes nothing else — no deletes, updates, policies or functions", () => {
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|DROP|ALTER|CREATE)\b/);
  });
});

describe("migration 292 — runbook", () => {
  it("ships verify queries and a commented-out rollback", () => {
    expect(raw).toMatch(/-- Verify/);
    expect(raw).toMatch(/-- ROLLBACK/);
    expect(raw).toMatch(/--\s+DELETE FROM public\.roles WHERE name = 'school_leader';/);
  });
});
