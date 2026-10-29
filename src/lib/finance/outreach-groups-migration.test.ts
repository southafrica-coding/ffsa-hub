import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 273 is applied by hand in the Supabase SQL editor, so nothing
// runs it in CI. These checks read the SQL itself and pin down the parts
// that matter for access: every outreach policy that let leaders in now
// lets group managers in too, read policies still hold every condition
// they had, and the file is safe to run twice.

const DIR = path.resolve(__dirname, "../../../supabase/migrations");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const FILE = "273_outreach_groups_and_managers.sql";
const sql = read(FILE);

type Policy = { name: string; table: string; body: string };

function policies(text: string): Policy[] {
  const out: Policy[] = [];
  const re = /CREATE POLICY "([^"]+)" ON public\.(\w+)([\s\S]*?);/g;
  for (const m of text.matchAll(re)) out.push({ name: m[1], table: m[2], body: m[3] });
  return out;
}

function fnBody(text: string, name: string): string {
  const re = new RegExp(`FUNCTION public\\.${name}\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`);
  const m = text.match(re);
  if (!m) throw new Error(`function ${name} not found`);
  return m[1];
}

const p273 = policies(sql);
const find = (table: string, name: string) => p273.find((p) => p.table === table && p.name === name);

// The policies that let a team's leaders in before this migration.
const leaderPolicies = [...policies(read("260_outreach_owner_coleaders.sql")), ...policies(read("263_outreach_cash_pull_batches.sql"))]
  .filter((p) => p.body.includes("is_outreach_leader("));

describe("migration 273 — group managers reach everything leaders reach", () => {
  it("found the leader policies to check", () => {
    expect(leaderPolicies.length).toBeGreaterThan(15);
  });

  it.each(leaderPolicies.map((p) => [`${p.table} / ${p.name}`, p] as const))(
    "%s is rebuilt with the group layer",
    (_label, before) => {
      const after = find(before.table, before.name);
      expect(after, "policy not recreated").toBeDefined();
      expect(after!.body).toMatch(/is_outreach_group_manager\(|can_view_outreach_team\(|can_edit_outreach_team\(/);
    }
  );

  it("the write helpers every other money policy and RPC uses now include managers", () => {
    expect(fnBody(sql, "can_edit_outreach_budget")).toContain("can_edit_outreach_team(");
    expect(fnBody(sql, "is_outreach_finance_admin")).toContain("can_edit_outreach_team(");
    expect(fnBody(sql, "can_edit_outreach_team")).toContain("is_outreach_group_manager(");
  });

  it("closeout approval stays with administrators", () => {
    for (const name of ["Submit closeouts", "Update closeouts"]) {
      const body = find("outreach_closeouts", name)!.body;
      const check = body.slice(body.indexOf("WITH CHECK"));
      // Leaders and managers only ever write the two non-approval states.
      expect(check).toMatch(/is_outreach_group_manager\(team_id\)\)\s*AND status IN \('auto_closed', 'pending'\)/);
    }
  });

  it("managers only add and remove plain team members", () => {
    for (const name of ["Add team members", "Remove team members"]) {
      const body = find("outreach_team_members", name)!.body;
      expect(body).toMatch(/role = 'team_member' AND \(\s*public\.is_outreach_leader\(team_id\) OR public\.is_outreach_group_manager\(team_id\)/);
    }
    expect(find("outreach_team_members", "Change team member roles")).toBeUndefined();
  });
});

describe("migration 273 — nobody's access shrinks", () => {
  it("can_view_outreach_team keeps the old read rule and adds the group layer", () => {
    const body = fnBody(sql, "can_view_outreach_team");
    for (const part of [
      "is_outreach_staff_viewer()",
      "is_outreach_leader(check_team_id)",
      "is_outreach_group_manager(check_team_id)",
      "is_outreach_group_peer_leader(check_team_id)",
    ]) {
      expect(body).toContain(part);
    }
  });

  it("can_edit_outreach_team keeps staff editors and leaders, and gives group peers nothing", () => {
    const body = fnBody(sql, "can_edit_outreach_team");
    expect(body).toContain("is_outreach_staff_editor()");
    expect(body).toContain("is_outreach_leader(check_team_id)");
    expect(body).not.toContain("peer");
  });

  it("every rebuilt policy keeps each helper it used before", () => {
    const old = [...policies(read("260_outreach_owner_coleaders.sql")), ...policies(read("263_outreach_cash_pull_batches.sql"))];
    for (const after of p273) {
      const before = old.find((p) => p.table === after.table && p.name === after.name);
      if (!before) continue;
      const helpers = before.body.match(/is_outreach_\w+\(|can_edit_outreach_budget\(/g) ?? [];
      for (const h of new Set(helpers)) {
        // A read rule folded into can_view_outreach_team still holds it.
        const folded =
          after.body.includes("can_view_outreach_team(") &&
          ["is_outreach_staff_viewer(", "is_outreach_leader("].includes(h);
        const foldedEdit =
          after.body.includes("can_edit_outreach_team(") &&
          ["is_outreach_staff_editor(", "is_outreach_leader("].includes(h);
        expect(after.body.includes(h) || folded || foldedEdit, `${after.table} / ${after.name} lost ${h}`).toBe(true);
      }
    }
  });

  it("does not touch roles or permissions", () => {
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(user_roles|user_permissions|role_permissions)\b/i);
  });
});

describe("migration 273 — group tables", () => {
  it.each(["outreach_groups", "outreach_group_teams", "outreach_group_managers"])(
    "%s has RLS on",
    (table) => {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
  );

  it("only administrators create, change or delete groups and assign managers", () => {
    for (const [table, name] of [
      ["outreach_groups", "Create outreach groups"],
      ["outreach_groups", "Update outreach groups"],
      ["outreach_groups", "Delete outreach groups"],
      ["outreach_group_managers", "Add group managers"],
      ["outreach_group_managers", "Remove group managers"],
    ]) {
      const body = find(table, name)!.body;
      expect(body).toContain("is_outreach_staff_editor()");
      expect(body).not.toContain("manages_outreach_group");
    }
  });

  it("managers add and remove teams only in groups they manage", () => {
    expect(find("outreach_group_teams", "Add group teams")!.body).toContain("can_manage_outreach_group(group_id)");
    expect(find("outreach_group_teams", "Remove group teams")!.body).toContain("can_manage_outreach_group(group_id)");
    expect(fnBody(sql, "can_manage_outreach_group")).toMatch(/is_outreach_staff_editor\(\) OR public\.manages_outreach_group\(p_group\)/);
  });

  it("manager access is read live from the link tables", () => {
    const body = fnBody(sql, "is_outreach_group_manager");
    expect(body).toContain("outreach_group_teams");
    expect(body).toContain("outreach_group_managers");
  });

  it("helpers are SECURITY DEFINER with a fixed search_path", () => {
    const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$/g)];
    expect(fns.length).toBeGreaterThan(10);
    for (const f of fns) {
      expect(f[0], f[1]).toContain("SECURITY DEFINER");
      expect(f[0], f[1]).toContain("SET search_path = public");
    }
  });
});

describe("migration 273 — safe to run twice", () => {
  it("every policy is dropped by name before it is created", () => {
    for (const p of p273) {
      const drop = `DROP POLICY IF EXISTS "${p.name}" ON public.${p.table};`;
      const create = `CREATE POLICY "${p.name}" ON public.${p.table}`;
      expect(sql.indexOf(drop), drop).toBeGreaterThanOrEqual(0);
      expect(sql.indexOf(drop)).toBeLessThan(sql.indexOf(create));
    }
  });

  it("tables, indexes and functions are all re-runnable", () => {
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(sql).not.toMatch(/CREATE FUNCTION/);
  });

  it("its number is not shared", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    expect(files.filter((f) => f.startsWith("273_"))).toEqual([FILE]);
  });
});

// ────────────────────────────────────────────────────────────
// Migration 274 — "outreach limited to own teams"
// ────────────────────────────────────────────────────────────

const FILE_274 = "274_outreach_limited_to_own_teams.sql";
const sql274 = read(FILE_274);
const p274 = policies(sql274);
// The same SQL with comments stripped, for "does not do X" checks.
const code274 = sql274.replace(/--.*$/gm, "");

describe("migration 274 — the flag closes only the finance.view / finance.edit path", () => {
  it("the staff viewer keeps admins and finance_admin unconditionally", () => {
    const body = fnBody(sql274, "is_outreach_staff_viewer");
    expect(body).toMatch(/^\s*SELECT public\.is_admin\(\)\s+OR public\.has_role\('finance_admin'\)\s+OR \(/);
    expect(body).toMatch(
      /\(public\.has_permission\('finance\.view'\) OR public\.has_permission\('finance\.edit'\)\)\s+AND NOT public\.is_outreach_limited_to_own_teams\(\)/
    );
  });

  it("the staff editor keeps admins and finance_admin unconditionally", () => {
    const body = fnBody(sql274, "is_outreach_staff_editor");
    expect(body).toMatch(/^\s*SELECT public\.is_admin\(\)\s+OR public\.has_role\('finance_admin'\)\s+OR \(/);
    expect(body).toMatch(/public\.has_permission\('finance\.edit'\)\s+AND NOT public\.is_outreach_limited_to_own_teams\(\)/);
  });

  it("without the flag both helpers answer exactly as migration 260's did", () => {
    // Drop the carve-out and compare against 260's bodies, whitespace-blind.
    const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
    const strip = (s: string) =>
      norm(s)
        .replace(/OR \(\((.*)\) AND NOT public\.is_outreach_limited_to_own_teams\(\)\);$/, "OR $1;")
        .replace(/OR \((public\.has_permission\('finance\.edit'\)) AND NOT public\.is_outreach_limited_to_own_teams\(\)\);$/, "OR $1;");
    const sql260 = read("260_outreach_owner_coleaders.sql");
    for (const fn of ["is_outreach_staff_viewer", "is_outreach_staff_editor"]) {
      expect(strip(fnBody(sql274, fn)), fn).toBe(norm(fnBody(sql260, fn)));
    }
  });

  it("the flag is read for the caller only", () => {
    const body = fnBody(sql274, "is_outreach_limited_to_own_teams");
    expect(body).toContain("outreach_user_restrictions");
    expect(body).toContain("user_id = auth.uid()");
    expect(body).toContain("limited_to_own_teams");
  });

  it("has_permission itself is left alone, so the rest of Finance is unaffected", () => {
    expect(code274).not.toMatch(/FUNCTION public\.has_permission/);
    expect(code274).not.toMatch(/FUNCTION public\.has_role/);
    expect(code274).not.toMatch(/FUNCTION public\.is_admin/);
  });

  it("every other outreach helper still reaches staff access only through the two staff helpers", () => {
    // The newest definition of each outreach helper (273) must not test
    // finance permissions itself, or the flag would not reach it.
    for (const fn of [
      "can_view_outreach_team",
      "can_edit_outreach_team",
      "can_edit_outreach_budget",
      "is_outreach_finance_admin",
      "can_add_outreach_category",
      "can_manage_outreach_group",
    ]) {
      expect(fnBody(sql, fn), fn).not.toMatch(/has_permission|finance_admin'/);
    }
  });

  it("rebuilds no outreach policy", () => {
    expect(p274.every((p) => p.table === "outreach_user_restrictions")).toBe(true);
  });
});

describe("migration 274 — the restriction table", () => {
  it("has RLS on", () => {
    expect(sql274).toContain("ALTER TABLE public.outreach_user_restrictions ENABLE ROW LEVEL SECURITY;");
  });

  it("admins read everyone's row; a person reads only their own", () => {
    const read = p274.find((p) => p.name === "Read outreach restrictions")!;
    expect(read.body).toMatch(/FOR SELECT\s+USING \(public\.is_admin\(\) OR user_id = auth\.uid\(\)\)/);
  });

  it.each(["Add outreach restrictions", "Change outreach restrictions", "Remove outreach restrictions"])(
    "%s is admins only",
    (name) => {
      const body = p274.find((p) => p.name === name)!.body;
      expect(body.replace(/public\.is_admin\(\)/g, "")).not.toMatch(/auth\.uid|public\.\w+\(/);
      expect(body).toContain("public.is_admin()");
    }
  );

  it("helpers are SECURITY DEFINER with a fixed search_path", () => {
    const fns = [...sql274.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$/g)];
    expect(fns.map((f) => f[1]).sort()).toEqual([
      "is_outreach_limited_to_own_teams",
      "is_outreach_staff_editor",
      "is_outreach_staff_viewer",
    ]);
    for (const f of fns) {
      expect(f[0], f[1]).toContain("SECURITY DEFINER");
      expect(f[0], f[1]).toContain("SET search_path = public");
    }
  });
});

describe("migration 274 — data", () => {
  it("does not touch roles or permissions", () => {
    expect(code274).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(user_roles|user_permissions|role_permissions|permissions|roles)\b/i);
  });

  it("writes only one row, for stephankuhn05@gmail.com looked up by email", () => {
    const inserts = [...code274.matchAll(/INSERT INTO\s+([\w.]+)/g)].map((m) => m[1]);
    expect(inserts).toEqual(["public.outreach_user_restrictions"]);
    expect(code274).not.toMatch(/\bUPDATE\s+public\./);
    expect(code274).not.toMatch(/\bDELETE\s+FROM/i);
    const seed = code274.slice(code274.indexOf("INSERT INTO public.outreach_user_restrictions"));
    expect(seed).toMatch(/FROM auth\.users au\s+JOIN public\.users u ON u\.id = au\.id/);
    expect(seed).toMatch(/WHERE lower\(au\.email\) = lower\('stephankuhn05@gmail\.com'\)/);
    expect(seed).toMatch(/SELECT u\.id, true/);
    expect(seed).toMatch(/ON CONFLICT \(user_id\) DO NOTHING;/);
  });
});

describe("migration 274 — safe to run twice and in order", () => {
  it("every policy is dropped by name before it is created", () => {
    for (const p of p274) {
      const drop = `DROP POLICY IF EXISTS "${p.name}" ON public.${p.table};`;
      expect(sql274.indexOf(drop), drop).toBeGreaterThanOrEqual(0);
      expect(sql274.indexOf(drop)).toBeLessThan(sql274.indexOf(`CREATE POLICY "${p.name}"`));
    }
  });

  it("tables, indexes and functions are all re-runnable", () => {
    expect(code274).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code274).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code274).not.toMatch(/CREATE FUNCTION/);
    expect(code274).not.toMatch(/\bDROP (TABLE|FUNCTION)\b/);
  });

  // Later migrations (275+) may follow, so this checks order, not "newest".
  it("comes right after 273, and its number is not shared", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    const numbers = files.map((f) => Number(f.slice(0, 3)));
    expect(numbers).toContain(273);
    expect(Math.max(...numbers)).toBeGreaterThanOrEqual(274);
    expect(files.filter((f) => f.startsWith("274_"))).toEqual([FILE_274]);
  });
});
