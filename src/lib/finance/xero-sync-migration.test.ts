import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 291 is applied by hand in the Supabase SQL editor, so nothing
// runs it in CI. These checks read the SQL and pin down what the PR promises.

const ROOT = path.resolve(__dirname, "../../..");
const FILE = "291_finance_xero_sync.sql";
const sql = readFileSync(path.join(ROOT, "supabase/migrations", FILE), "utf8");
const code = sql.replace(/--.*$/gm, "");
const top = code.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
const fn = code.match(/CREATE OR REPLACE FUNCTION public\.finance_org_choices\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";

describe("migration 291 — file", () => {
  it("is number 291 and follows 290", () => {
    expect(FILE.startsWith("291_")).toBe(true);
    expect(sql).toMatch(/Migration 291/);
    expect(sql).toMatch(/after 275[\s\S]*and 290/);
  });

  it("has a header, verify queries and a commented ROLLBACK block", () => {
    expect(sql.startsWith("-- ====")).toBe(true);
    expect(sql).toMatch(/-- Verify:/);
    expect(sql).toMatch(/-- ROLLBACK:/);
    expect(sql).toMatch(/--\s+ALTER TABLE public\.finance_projects DROP COLUMN IF EXISTS xero_tracking_option_id;/);
    expect(sql).toMatch(/--\s+DROP FUNCTION IF EXISTS public\.finance_org_choices\(\);/);
  });

  it("explains that Xero owns names once a project is linked, and that 290's CSV is a bootstrap", () => {
    expect(sql).toMatch(/Xero is the source of truth/);
    expect(sql).toMatch(/CSV seed in 290 is only a bootstrap/);
    expect(sql).toMatch(/the sync owns the project's name/);
  });
});

describe("migration 291 — safe to run twice", () => {
  it("uses only re-runnable statements", () => {
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    expect(top).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(top).not.toMatch(/\bUPDATE\s+public\./i);
    expect(code).not.toMatch(/\bTRUNCATE\b|\bDROP TABLE\b|\bDROP COLUMN\b/);
  });

  it("drops each CHECK constraint by name before adding it again", () => {
    for (const name of ["xero_sync_runs_trigger_check", "xero_sync_runs_status_check"]) {
      const drop = code.indexOf(`DROP CONSTRAINT IF EXISTS ${name};`);
      const add = code.indexOf(`ADD CONSTRAINT ${name}`);
      expect(drop, name).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(add);
    }
  });

  it("seeds only with ON CONFLICT DO NOTHING, so an admin's edit is never overwritten", () => {
    const inserts = [...top.matchAll(/INSERT INTO public\.(\w+)[\s\S]*?;/g)];
    expect(inserts.map((i) => i[1])).toEqual(["xero_tracking_roles"]);
    expect(inserts[0][0]).toMatch(/ON CONFLICT \(role_key, org_region\) DO NOTHING;$/);
  });
});

describe("migration 291 — what it adds", () => {
  it("seeds the ministries role for za and us", () => {
    expect(code).toMatch(/\('ministries', 'za', 'Ministries'\)/);
    expect(code).toMatch(/\('ministries', 'us', 'Ministries'\)/);
  });

  it("adds a nullable, unique-when-set link from projects to Xero options", () => {
    expect(code).toMatch(
      /ALTER TABLE public\.finance_projects\s+ADD COLUMN IF NOT EXISTS xero_tracking_option_id uuid\s+REFERENCES public\.xero_tracking_options\(id\) ON DELETE SET NULL;/
    );
    expect(code).not.toMatch(/xero_tracking_option_id uuid[^;]*NOT NULL/);
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS finance_projects_xero_option_key\s+ON public\.finance_projects \(xero_tracking_option_id\)\s+WHERE xero_tracking_option_id IS NOT NULL;/
    );
  });

  it("allows the automatic triggers and 'skipped', and one running sync per region", () => {
    expect(code).toMatch(/CHECK \(trigger IN \('cron', 'manual', 'view', 'reconnect'\)\)/);
    expect(code).toMatch(/CHECK \(status IN \('running', 'succeeded', 'partial', 'failed', 'skipped'\)\)/);
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS xero_sync_runs_one_running_per_region\s+ON public\.xero_sync_runs \(org_region\)\s+WHERE status = 'running';/);
  });

  it("adds no account-code column and no write policy on the mirror", () => {
    expect(code).not.toMatch(/\baccount_(id|code)\b/i);
    expect(code).not.toMatch(/CREATE POLICY/);
  });
});

describe("migration 291 — finance_org_choices()", () => {
  it("returns only the org's id, key, name, currency and active flag", () => {
    expect(code).toMatch(/RETURNS TABLE \(id uuid, key text, name text, record_currency text, is_active boolean\)/);
    expect(fn).toMatch(/SELECT o\.id, o\.key, o\.name, o\.record_currency, o\.is_active\s+FROM public\.finance_orgs o/);
    expect(fn).not.toMatch(/finance_projects|xero_/);
  });

  it("is for signed-in event editors and finance readers only", () => {
    expect(fn).toMatch(/auth\.uid\(\) IS NOT NULL/);
    for (const gate of [
      "public.is_admin()",
      "public.has_role('events_admin')",
      "public.has_permission('events.create')",
      "e.created_by = auth.uid()",
      "public.has_role('finance_admin')",
      "public.has_permission('finance.view')",
      "public.has_permission('finance.edit')",
    ]) {
      expect(fn, gate).toContain(gate);
    }
    // A plain signed-in user matches none of these: no `OR true`, no bare role check.
    expect(fn).not.toMatch(/OR\s+true|has_role\('staff'\)/);
  });

  it("is SECURITY DEFINER with a fixed search_path, and not callable by anon", () => {
    expect(code).toMatch(/finance_org_choices\(\)[\s\S]*?SECURITY DEFINER\s+SET search_path = public/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.finance_org_choices\(\) FROM PUBLIC, anon;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.finance_org_choices\(\) TO authenticated, service_role;/);
  });
});
