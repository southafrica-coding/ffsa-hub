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

  it("is the newest migration and its number is not shared", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    const numbers = files.map((f) => Number(f.slice(0, 3)));
    expect(Math.max(...numbers)).toBe(273);
    expect(files.filter((f) => f.startsWith("273_"))).toEqual([FILE]);
  });
});
