import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migrations 277–279 are applied by hand in the Supabase SQL editor, so
// nothing runs them in CI. These checks read the SQL and pin down the
// promises the PR makes: safe to run twice, nothing hard-deleted, no Xero
// codes invented, no role handed to a person, views run as the caller.

const DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FILES = {
  277: "277_finance_audit_permissions_periods.sql",
  278: "278_budgets_core.sql",
  279: "279_budget_views.sql",
} as const;
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
// SQL without comments, so the header's ROLLBACK block doesn't count as code.
const code = (text: string) => text.replace(/--.*$/gm, "");
// ...and without function bodies, for statements that must not run at apply time.
const topLevel = (text: string) => code(text).replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
const all = Object.values(FILES).map((f) => ({ file: f, sql: read(f), code: code(read(f)), top: topLevel(read(f)) }));

describe("migrations 277–279 — safe to run twice", () => {
  it.each(all.map((m) => [m.file, m] as const))("%s uses only re-runnable statements", (_f, m) => {
    expect(m.code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(m.code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(m.code).not.toMatch(/CREATE FUNCTION/);
    expect(m.code).not.toMatch(/\bDROP TABLE\b/);
    expect(m.top).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(m.code).not.toMatch(/\bTRUNCATE\b(?! ON public\.finance_audit_log)/);
  });

  it.each(all.map((m) => [m.file, m] as const))("%s drops every policy and trigger by name before creating it", (_f, m) => {
    for (const [, name, table] of m.code.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.(\w+)/g)) {
      const drop = `DROP POLICY IF EXISTS "${name}" ON public.${table};`;
      expect(m.code.indexOf(drop), drop).toBeGreaterThanOrEqual(0);
      expect(m.code.indexOf(drop)).toBeLessThan(m.code.indexOf(`CREATE POLICY "${name}"`));
    }
    for (const [, name, table] of m.code.matchAll(/CREATE TRIGGER (\w+)\s+[\s\S]*?ON public\.(\w+)/g)) {
      expect(m.code, name).toContain(`DROP TRIGGER IF EXISTS ${name} ON public.${table};`);
    }
  });

  it.each(all.map((m) => [m.file, m] as const))("%s seeds with ON CONFLICT DO NOTHING", (_f, m) => {
    const inserts = [...m.top.matchAll(/INSERT INTO public\.(\w+)[\s\S]*?;/g)];
    for (const ins of inserts) expect(ins[0], ins[1]).toMatch(/ON CONFLICT \([^)]+\) DO NOTHING;$/);
  });

  it("every file has a plain-English header, apply order, verify queries and a ROLLBACK block", () => {
    for (const m of all) {
      expect(m.sql.startsWith("-- ====")).toBe(true);
      expect(m.sql).toMatch(/APPLY ORDER: 275/);
      expect(m.sql).toMatch(/-- Verify:/);
      expect(m.sql).toMatch(/-- ROLLBACK/);
    }
  });
});

describe("migrations 277–279 — the decisions they encode", () => {
  const m277 = all[0].code;
  const m278 = all[1].code;
  const m279 = all[2].code;

  it("gives finance_admin view/edit/codes, and budget.approve ONLY to the budget_approver role", () => {
    for (const key of ["budget.view_all", "budget.edit_all", "budget.manage_codes", "budget.approve"]) {
      expect(m277).toContain(`'${key}'`);
    }
    const grants = [...m277.matchAll(/INSERT INTO public\.role_permissions[\s\S]*?WHERE r\.name = '(\w+)'[\s\S]*?;/g)];
    const byRole = Object.fromEntries(grants.map((g) => [g[1], g[0]]));
    expect(Object.keys(byRole).sort()).toEqual(["budget_approver", "finance_admin"]);
    expect(byRole.finance_admin).not.toContain("budget.approve");
    expect(byRole.budget_approver).toContain("p.key = 'budget.approve'");
    expect(m277).toMatch(/INSERT INTO public\.roles \(name, display_name, description, is_system\)\s+VALUES \(\s+'budget_approver'/);
  });

  it("approval checks the permission alone, and the trigger enforces it", () => {
    expect(m277).toMatch(/FUNCTION public\.can_approve_budgets\(\)[\s\S]*?AS \$\$\s+SELECT public\.has_permission\('budget\.approve'\);\s+\$\$/);
    expect(m278).toMatch(/IF NEW\.status = 'approved' AND OLD\.status IS DISTINCT FROM 'approved' THEN\s+IF v_uid IS NOT NULL AND NOT public\.can_approve_budgets\(\)/);
    expect(m278).toMatch(/NEW\.approved_by := v_uid;/);
  });

  it("assigns no role or permission to a person", () => {
    for (const m of all) {
      expect(m.code).not.toMatch(/INSERT INTO public\.(user_roles|user_permissions)/);
      expect(m.code).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i); // no email addresses
    }
  });

  it("seeds only the 'Not sure yet' category and no Xero codes, accounts or periods", () => {
    const categorySeeds = [...m278.matchAll(/INSERT INTO public\.budget_categories[\s\S]*?;/g)];
    expect(categorySeeds).toHaveLength(1);
    expect(categorySeeds[0][0]).toContain("'not_sure_yet', 'Not sure yet'");
    for (const m of all) {
      expect(m.code).not.toMatch(/INSERT INTO public\.(xero_\w+|budget_category_coding|fiscal_periods)\b/);
    }
  });

  it("the standard template has the six sheet sections and no lines", () => {
    for (const key of ["overview", "dashboard", "variable", "fixed", "expense_tracker", "notes"]) {
      expect(m278).toMatch(new RegExp(`\\('${key}',`));
    }
    expect(all[1].top).not.toMatch(/INSERT INTO public\.budget_template_lines/);
    expect(m278).toMatch(/holds_lines\s+boolean GENERATED ALWAYS AS \(key IN \('fixed', 'variable'\)\) STORED/);
  });

  it("totals are trigger-computed in cents", () => {
    expect(m278).toMatch(/NEW\.line_total_cents := round\(NEW\.amount_cents \* NEW\.frequency \* NEW\.multiplier\)::bigint;/);
    expect(m278).toMatch(/amount_cents\s+bigint NOT NULL/);
  });

  it.each(["create_budget_from_template", "copy_budget_to_period", "save_budget_as_template"])(
    "%s runs as the caller and anon cannot call it",
    (fn) => {
      expect(m278).toMatch(new RegExp(`FUNCTION public\\.${fn}\\([^$]*?SECURITY INVOKER`));
      expect(m278).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
  );

  it("the copied-coding helper (finance data) is not callable by app users", () => {
    expect(m278).toMatch(/REVOKE ALL ON FUNCTION public\.budget_source_coding\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
  });

  it("no hard deletes: no DELETE policy on budgets, sections or lines", () => {
    const deletePolicies = [...m278.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.(\w+) FOR (DELETE|ALL)/g)].map((x) => x[1]);
    expect(deletePolicies.sort()).toEqual(["budget_category_coding", "budget_line_coding", "budget_members", "budget_template_line_coding"]);
  });

  it("the audit log cannot be changed", () => {
    expect(m277).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.finance_audit_log FROM PUBLIC, anon, authenticated, service_role;/);
    expect(m277).toMatch(/BEFORE UPDATE OR DELETE ON public\.finance_audit_log/);
    expect(m277).toMatch(/BEFORE TRUNCATE ON public\.finance_audit_log/);
  });

  it("every view runs as the caller", () => {
    expect([...m279.matchAll(/CREATE VIEW public\.(\w+)\s+WITH \(security_invoker = true\)/g)].map((x) => x[1]))
      .toEqual(["v_budget_lines_flat", "v_budget_summary", "v_budget_yoy"]);
  });

  it("hard-codes no ids: owners are looked up, never pasted in", () => {
    for (const m of all) {
      expect(m.code).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
    }
  });
});

describe("migrations 277–279 — numbering", () => {
  it("277, 278 and 279 are each used once", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    for (const [n, f] of Object.entries(FILES)) {
      expect(files.filter((x) => x.startsWith(`${n}_`))).toEqual([f]);
    }
  });
});
