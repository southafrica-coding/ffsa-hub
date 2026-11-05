import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 290 is applied by hand in the Supabase SQL editor, so nothing
// runs it in CI. These checks read the SQL (and the two Xero CSV exports it
// was seeded from) and pin down the promises the PR makes.

const ROOT = path.resolve(__dirname, "../../..");
const FILE = "290_finance_orgs_and_projects.sql";
const sql = readFileSync(path.join(ROOT, "supabase/migrations", FILE), "utf8");
// SQL without comments, so the header's ROLLBACK block doesn't count as code.
const code = sql.replace(/--.*$/gm, "");
// ...and without function bodies, for statements that must not run at apply time.
const top = code.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");

function csvOptions(name: string): string[] {
  const text = readFileSync(path.join(ROOT, "supabase/seed-data/finance", name), "utf8");
  const [, ...rows] = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return rows.map((r) => {
    const [, category, ...rest] = r.split(",");
    expect(category).toBe("Ministries");
    return rest.join(",").trim();
  });
}

// The seeded (org_key, sort_order, name) tuples, in file order.
const seeded = [...code.matchAll(/\('(npc|usa)',\s*(\d+),\s*'((?:[^']|'')*)'\)/g)].map((m) => ({
  org: m[1],
  sort: Number(m[2]),
  name: m[3].replace(/''/g, "'"),
}));

describe("migration 290 — file", () => {
  it("is number 290 and the next after 289", () => {
    expect(FILE.startsWith("290_")).toBe(true);
    expect(sql).toMatch(/Migration 290/);
  });

  it("has a header, verify queries and a ROLLBACK block", () => {
    expect(sql.startsWith("-- ====")).toBe(true);
    expect(sql).toMatch(/-- Verify:/);
    expect(sql).toMatch(/-- ROLLBACK/);
    expect(sql).toMatch(/must be\s*\n--\s*NULLABLE until the chart of accounts arrives/);
  });
});

describe("migration 290 — safe to run twice", () => {
  it("uses only re-runnable statements", () => {
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    expect(top).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/);
  });

  it("has no DROP TABLE outside the commented ROLLBACK block", () => {
    expect(code).not.toMatch(/\bDROP TABLE\b/);
    expect(code).not.toMatch(/\bDROP COLUMN\b/);
    expect(sql).toMatch(/--\s+DROP TABLE IF EXISTS public\.finance_projects/);
  });

  it("drops every policy and trigger by name before creating it", () => {
    for (const [, name, table] of code.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.(\w+)/g)) {
      const drop = `DROP POLICY IF EXISTS "${name}" ON public.${table};`;
      expect(code.indexOf(drop), drop).toBeGreaterThanOrEqual(0);
      expect(code.indexOf(drop)).toBeLessThan(code.indexOf(`CREATE POLICY "${name}"`));
    }
    for (const [, name, table] of code.matchAll(/CREATE TRIGGER (\w+)\s+[\s\S]*?ON public\.(\w+)/g)) {
      expect(code, name).toContain(`DROP TRIGGER IF EXISTS ${name} ON public.${table};`);
    }
  });

  it("seeds with ON CONFLICT DO NOTHING and guards its ALTER TABLE constraint", () => {
    const inserts = [...top.matchAll(/INSERT INTO public\.(\w+)[\s\S]*?;/g)];
    expect(inserts.length).toBe(2);
    for (const ins of inserts) expect(ins[0], ins[1]).toMatch(/ON CONFLICT \([^)]+\) DO NOTHING;$/);
    expect(code).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE conname = 'finance_projects_org_name_key'/);
  });
});

describe("migration 290 — the seed", () => {
  it("seeds the two orgs exactly", () => {
    expect(code).toMatch(/\('npc', 'FFSA NPC',\s+'za', 'ZAR'\)/);
    expect(code).toMatch(/\('usa', 'FF USA Inc', 'us', 'USD'\)/);
  });

  it.each([
    ["npc", "ffsa-npc-tracking-categories.csv", 38],
    ["usa", "ff-usa-inc-tracking-categories.csv", 32],
  ] as const)("seeds %s with exactly the CSV's options, spelled and ordered as in Xero", (org, csv, count) => {
    const expected = csvOptions(csv);
    expect(expected).toHaveLength(count);
    const rows = seeded.filter((s) => s.org === org);
    expect(rows.map((r) => r.name)).toEqual(expected);
    expect(rows.map((r) => r.sort)).toEqual(expected.map((_, i) => i + 1));
  });

  it("keeps near-duplicate names in both orgs as separate projects", () => {
    const names = (org: string) => seeded.filter((s) => s.org === org).map((s) => s.name);
    expect(names("npc")).toContain("EFLTanz");
    expect(names("usa")).toContain("EFL Tanz");
    expect(names("npc")).toContain("Missio to Base (10%)");
    expect(names("usa")).toContain("Mission to Base (10%)");
  });

  it("sets no project type and no cross-org link on any seeded row", () => {
    const seedInsert = top.match(/INSERT INTO public\.finance_projects \(([^)]*)\)/);
    expect(seedInsert?.[1].split(",").map((c) => c.trim())).toEqual(["org_id", "sort_order", "name"]);
    expect(top).not.toMatch(/'(ministry|event|asset)'\s*\)?\s*,?\s*\n?\s*\(?'(npc|usa)'/);
    expect(top).not.toMatch(/UPDATE public\.finance_projects/);
    expect(top).not.toMatch(/linked_project_id\s*=/);
  });
});

describe("migration 290 — the decisions it encodes", () => {
  it("adds no currency → org routing and no default org", () => {
    expect(code).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.\w*currency\w*/i);
    expect(code).not.toMatch(/finance_org_id uuid[^;]*DEFAULT/i);
    expect(code).toMatch(/ALTER TABLE public\.events\s+ADD COLUMN IF NOT EXISTS finance_org_id uuid REFERENCES public\.finance_orgs\(id\) ON DELETE SET NULL;/);
    expect(code).toMatch(/ALTER TABLE public\.orders\s+ADD COLUMN IF NOT EXISTS finance_org_id uuid REFERENCES public\.finance_orgs\(id\) ON DELETE SET NULL;/);
    expect(code).toMatch(/SELECT coalesce\(o\.finance_org_id, e\.finance_org_id\)/);
  });

  it("adds no account-code column", () => {
    expect(code).not.toMatch(/\baccount_(id|code)\b/i);
    expect(code).not.toMatch(/\baccount\w*\s+(uuid|text)/i);
  });

  it("enables RLS on both tables, with no DELETE policy and no anon access", () => {
    expect(code).toContain("ALTER TABLE public.finance_orgs     ENABLE ROW LEVEL SECURITY;");
    expect(code).toContain("ALTER TABLE public.finance_projects ENABLE ROW LEVEL SECURITY;");
    expect(code).not.toMatch(/FOR DELETE/);
    expect(code).not.toMatch(/TO anon/);
    for (const [, cmd] of code.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.\w+ FOR (\w+)/g)) {
      expect(["SELECT", "INSERT", "UPDATE"]).toContain(cmd);
    }
  });

  it("lets only admins write orgs", () => {
    const orgWrites = [...code.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.finance_orgs FOR (INSERT|UPDATE)[\s\S]*?;/g)];
    expect(orgWrites).toHaveLength(2);
    for (const p of orgWrites) {
      expect(p[0]).toContain("public.is_admin()");
      expect(p[0]).not.toMatch(/has_role|has_permission/);
    }
  });

  it("guards org_id, the cross-org link and the Xero-owned fields in triggers", () => {
    expect(sql).toMatch(/NEW\.org_id IS DISTINCT FROM OLD\.org_id/);
    expect(sql).toMatch(/v_linked_org = NEW\.org_id/);
    expect(sql).toMatch(/NEW\.linked_project_id = NEW\.id/);
    expect(sql).toMatch(/NEW\.name IS DISTINCT FROM OLD\.name OR NEW\.source IS DISTINCT FROM OLD\.source/);
    expect(sql).toMatch(/NOT public\.is_admin\(\)/);
  });
});
