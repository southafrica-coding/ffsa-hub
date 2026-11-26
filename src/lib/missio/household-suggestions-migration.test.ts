import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 398 is not applied. These checks read the SQL text so the
// grants and policies can't drift before it is. The full role matrix is in
// supabase/tests/missio_household_suggestions_rls.sql (disposable database only).

const root = path.resolve(__dirname, "../../..");
const migration = readFileSync(path.join(root, "supabase/migrations/398_missio_household_suggestions.sql"), "utf8");
const code = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

describe("398 Missio household suggestions", () => {
  it("is the next migration and the only 398", () => {
    const files = readdirSync(path.join(root, "supabase/migrations")) as string[];
    expect(files.filter((f) => f.startsWith("398_"))).toEqual(["398_missio_household_suggestions.sql"]);
    expect(files.some((f) => f.startsWith("397_missio_whatsapp_bot"))).toBe(true);
  });

  it("is one transaction and adds no rows", () => {
    expect(code.trim().startsWith("BEGIN;")).toBe(true);
    expect(code.trim().endsWith("COMMIT;")).toBe(true);
    expect(code).not.toMatch(/INSERT INTO/i);
    expect(code).not.toMatch(/\b(DROP TABLE|DROP COLUMN|ALTER TABLE public\.missio_household(s|_members)\b)/i);
  });

  it("has the columns, statuses and one row per unordered pair", () => {
    for (const column of ["id", "org_id", "contact_a", "contact_b", "source", "source_line", "status", "reviewed_by", "reviewed_at", "created_at"]) {
      expect(code).toMatch(new RegExp(`\\n\\s+${column}\\s+(uuid|text|integer|timestamptz)`));
    }
    expect(code).toMatch(/CHECK \(status IN \('pending', 'accepted', 'dismissed'\)\)/);
    expect(code).toMatch(/CHECK \(contact_a < contact_b\)/);
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS missio_household_suggestions_pair_uidx\s+ON public\.missio_household_suggestions \(org_id, contact_a, contact_b\);/);
    expect(code).toMatch(/REFERENCES public\.organisations \(id\)/);
    expect(code).toMatch(/REFERENCES public\.contacts \(id\)/);
    expect(code).toMatch(/REFERENCES public\.users \(id\)/);
  });

  it("enables RLS, revokes everything, and grants pastors read + review only", () => {
    expect(code).toMatch(/ALTER TABLE public\.missio_household_suggestions ENABLE ROW LEVEL SECURITY;/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.missio_household_suggestions FROM PUBLIC, anon, authenticated;/);
    const grants = [...code.matchAll(/GRANT ([^;]+) ON TABLE (public\.\w+) TO (\w+);/g)].map((m) => `${m[1].trim()} | ${m[3]}`);
    expect(grants).toEqual(["SELECT | authenticated", "UPDATE (status, reviewed_by, reviewed_at) | authenticated"]);
    expect(code).not.toMatch(/TO anon/);
    expect(code).not.toMatch(/REVOKE[^;]*service_role/);
  });

  it("every policy is for Missio pastors; no insert or delete policy", () => {
    const policies = [...code.matchAll(/CREATE POLICY "[^"]+"\s+ON (public\.\w+) FOR (\w+)\s+TO (\w+)\s+USING \(([^)]+\))\)/g)];
    expect(policies.map((p) => `${p[2]} ${p[3]}`)).toEqual(["SELECT authenticated", "UPDATE authenticated"]);
    for (const p of policies) expect(p[4]).toBe("public.has_org_role_id(org_id, ARRAY['pastor'])");
    expect(code).not.toMatch(/FOR (INSERT|DELETE|ALL)/);
  });

  it("the review stamp is SECURITY DEFINER, empty search_path, and only moves pending forward", () => {
    const fn = code.match(/CREATE OR REPLACE FUNCTION public\.missio_household_suggestion_stamp\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = ''/);
    expect(fn).toMatch(/OLD\.status <> 'pending' OR NEW\.status NOT IN \('accepted', 'dismissed'\)/);
    expect(fn).toMatch(/NEW\.reviewed_by := v_uid;/);
    expect(fn).not.toMatch(/\b(INSERT|DELETE)\b/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.missio_household_suggestion_stamp\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it("is safe to re-run", () => {
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    for (const [, name, table] of code.matchAll(/CREATE POLICY ("[^"]+")\s+ON (public\.\w+)/g)) {
      expect(code).toContain(`DROP POLICY IF EXISTS ${name} ON ${table};`);
    }
    for (const [, name, table] of code.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE UPDATE ON (public\.\w+)/g)) {
      expect(code).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${table};`);
    }
  });

  it("has verify and rollback notes", () => {
    expect(migration).toMatch(/-- Verify:/);
    expect(migration).toMatch(/-- ROLLBACK/);
    expect(migration).toMatch(/DO NOT APPLY/);
  });
});
