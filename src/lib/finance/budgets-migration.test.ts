import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migrations 295–299 replace the unapplied 277–279 files on this branch.
// They are applied by hand, so CI only reads the SQL. They are once-only:
// do not promise a safe re-run or a rollback that deletes budgets.

const DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FILES = {
  295: "295_finance_audit_permissions_periods.sql",
  296: "296_budgets_core.sql",
  297: "297_budget_expense_tracker.sql",
  298: "298_budget_views.sql",
  299: "299_budget_privilege_hardening.sql",
} as const;
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const code = (text: string) => text.replace(/--.*$/gm, "");
const all = Object.values(FILES).map((f) => ({ file: f, sql: read(f), code: code(read(f)) }));
const joined = all.map((m) => m.code).join("\n");

describe("migrations 295–299 — numbering", () => {
  it("uses the five free numbers and does not take 293, 294, 276 or 277–279", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    for (const [n, f] of Object.entries(FILES)) {
      expect(files.filter((x) => x.startsWith(`${n}_`))).toEqual([f]);
    }
    // 276 (#441), 293 (#508) and 294 (#506) live on other branches. Do not
    // assert they are absent; that fails as soon as one of them merges.
    for (const gone of ["277", "278", "279"]) {
      expect(files.filter((x) => x.startsWith(`${gone}_`)), gone).toEqual([]);
    }
  });

  it("does not reapply the finance baseline already on main", () => {
    expect(joined).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.finance_orgs\b/);
    expect(joined).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.xero_accounts\b/);
    expect(joined).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.finance_projects\b/);
    expect(joined).not.toMatch(/INSERT INTO public\.finance_orgs\b/);
  });
});

describe("migrations 295–299 — security", () => {
  it("puts new security-definer helpers in finance_private and exposes no user_metadata", () => {
    expect(joined).not.toMatch(/user_metadata/);
    expect(joined).not.toMatch(/FUNCTION public\.\w+\([^)]*\)[\s\S]{0,240}?SECURITY DEFINER/);
    for (const name of [
      "can_edit_all_budgets",
      "can_view_all_budgets",
      "can_manage_budget_codes",
      "can_approve_budgets",
      "finance_audit_row",
      "budget_coding_before_write",
      "can_record_budget_expenses",
    ]) {
      expect(joined).toMatch(new RegExp(`FUNCTION finance_private\\.${name}`));
      expect(joined).not.toMatch(new RegExp(`FUNCTION public\\.${name}\\(`));
    }
  });

  it("enables row level security on every new table", () => {
    for (const table of [
      "fiscal_periods",
      "finance_audit_log",
      "budget_categories",
      "budget_category_coding",
      "budget_templates",
      "budget_template_sections",
      "budget_template_lines",
      "budget_template_line_coding",
      "budgets",
      "budget_sections",
      "budget_members",
      "budget_lines",
      "budget_line_coding",
      "budget_expenses",
    ]) {
      expect(joined).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    }
  });

  it("runs every view as the caller", () => {
    const views = [...joined.matchAll(/CREATE VIEW public\.(\w+)\s+WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/g)].map((m) => m[1]);
    expect(views.sort()).toEqual([
      "v_budget_coding_queue",
      "v_budget_expense_tracker",
      "v_budget_line_actuals",
      "v_budget_lines_flat",
      "v_budget_overview",
      "v_budget_summary",
      "v_budget_yoy",
    ]);
  });

  it("keeps the public create/copy/save RPCs invoker-only and away from anon", () => {
    const core = all[1].code;
    expect(core).toMatch(
      /FUNCTION public\.create_budget_from_template\(\s*p_template_id\s+uuid,\s*p_owner_kind\s+text,\s*p_owner_id\s+uuid,\s*p_period_id\s+uuid,\s*p_org_id\s+uuid(?:\s+DEFAULT NULL)?,/
    );
    for (const fn of ["create_budget_from_template", "copy_budget_to_period", "save_budget_as_template"]) {
      expect(core).toMatch(new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?SECURITY INVOKER`));
      expect(core).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    expect(core).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_budget_from_template\(uuid, text, uuid, uuid, uuid, text, text, text, numeric, boolean\) FROM PUBLIC, anon;/
    );
  });

  it("does not grant authenticated execute on the coding-copy or audit writers", () => {
    const grants = all[4].code;
    expect(grants).not.toMatch(/GRANT EXECUTE ON FUNCTION finance_private\.budget_source_coding/);
    expect(grants).not.toMatch(/GRANT EXECUTE ON FUNCTION finance_private\.finance_audit_row/);
    expect(grants).toMatch(/finance_private\.can_record_budget_expenses\(uuid\)/);
    expect(all[1].code).toMatch(/REVOKE ALL ON FUNCTION finance_private\.budget_source_coding\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("migrations 295–299 — the budget model", () => {
  const foundation = all[0].code;
  const core = all[1].code;
  const expenses = all[2].code;
  const views = all[3].code;

  it("gives finance_admin view/edit/codes, finance_office view only, and approve only to budget_approver", () => {
    for (const key of ["budget.view_all", "budget.edit_all", "budget.manage_codes", "budget.approve"]) {
      expect(foundation).toContain(`'${key}'`);
    }
    const grants = [...foundation.matchAll(/INSERT INTO public\.role_permissions[\s\S]*?WHERE r\.name = '(\w+)'[\s\S]*?;/g)];
    const byRole = Object.fromEntries(grants.map((g) => [g[1], g[0]]));
    expect(Object.keys(byRole).sort()).toEqual(["budget_approver", "finance_admin", "finance_office"]);
    expect(byRole.finance_admin).not.toContain("budget.approve");
    expect(byRole.budget_approver).toContain("p.key = 'budget.approve'");
    expect(byRole.finance_office).toContain("p.key = 'budget.view_all'");
    expect(byRole.finance_office).not.toMatch(/budget\.(edit_all|manage_codes|approve)/);
    expect(foundation).not.toMatch(/INSERT INTO public\.roles[\s\S]*?'finance_office'/);
    expect(foundation).toMatch(/'budget_approver'/);
  });

  it("checks budget permissions, never the finance_admin role, and approves from the permission alone", () => {
    for (const m of all) expect(m.code).not.toMatch(/has_(any_)?role\(\s*'finance_admin'/);
    expect(foundation).toMatch(/FUNCTION finance_private\.can_edit_all_budgets\(\)[\s\S]*?SELECT public\.is_admin\(\)\s+OR public\.has_permission\('budget\.edit_all'\);/);
    expect(foundation).toMatch(/FUNCTION finance_private\.can_approve_budgets\(\)[\s\S]*?SELECT public\.has_permission\('budget\.approve'\);/);
    expect(core).toMatch(/NOT finance_private\.can_approve_budgets\(\)/);
    expect(core).toMatch(/NEW\.approved_by := v_uid;/);
  });

  it("assigns no role or permission to a person and seeds no real periods or account codes", () => {
    for (const m of all) {
      expect(m.code).not.toMatch(/INSERT INTO public\.(user_roles|user_permissions)/);
      expect(m.code).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
      expect(m.code).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
      expect(m.code).not.toMatch(/INSERT INTO public\.(xero_\w+|budget_category_coding|fiscal_periods|outreach_)/);
    }
    const categorySeeds = [...core.matchAll(/INSERT INTO public\.budget_categories[\s\S]*?;/g)];
    expect(categorySeeds).toHaveLength(1);
    expect(categorySeeds[0][0]).toContain("'not_sure_yet', 'Not sure yet'");
  });

  it("requires one org, matching currency, and a period of that org, then freezes them", () => {
    expect(core).toMatch(/org_id\s+uuid NOT NULL REFERENCES public\.finance_orgs\(id\)/);
    expect(core).toMatch(/FOREIGN KEY\(org_id,currency\) REFERENCES public\.finance_orgs\(id,record_currency\)/);
    expect(core).toMatch(/FOREIGN KEY\(period_id,org_id\) REFERENCES public\.fiscal_periods\(id,org_id\)/);
    expect(core).toMatch(/NEW\.org_id IS DISTINCT FROM OLD\.org_id/);
    expect(core).toMatch(/NEW\.currency IS DISTINCT FROM OLD\.currency/);
    expect(core).toMatch(/NEW\.period_id IS DISTINCT FROM OLD\.period_id/);
    expect(foundation).toMatch(/Period org, dates and kind are immutable/);
    expect(core).toMatch(/o\.key = 'npc'/);
    expect(core).toMatch(/o\.record_currency = 'ZAR'/);
    expect(core).toMatch(/Hub budgets are for South Africa only \(FFSA NPC, ZAR\)/);
    expect(core).toMatch(/PERFORM finance_private\.assert_south_africa_budget_org\(NEW\.org_id\)/);
    expect(core).toMatch(/PERFORM finance_private\.assert_south_africa_budget_org\(v_org\)/);
    expect(core).toMatch(/currency\s+text NOT NULL CHECK \(currency = 'ZAR'\)/);
    expect(core).toMatch(/default_currency\s+text NOT NULL DEFAULT 'ZAR' CHECK \(default_currency = 'ZAR'\)/);
    expect(core).toMatch(/IF NEW\.org_id IS NOT NULL THEN\s+PERFORM finance_private\.assert_south_africa_budget_org\(NEW\.org_id\)/);
    expect(core).toMatch(/Hub budget templates are in ZAR/);
    expect(core).not.toMatch(/CHECK \(currency IN \('ZAR', 'USD'\)\)/);
    expect(core).not.toMatch(/CHECK \(default_currency IN \('ZAR', 'USD'\)\)/);
    expect(core).not.toMatch(/316e0b77-3f4d-437f-a86e-856e8467f0b9/);
  });

  it("keeps one entity, the outreach team fk, and one responsible owner on budget_members", () => {
    expect(core).toMatch(/num_nonnulls\(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id\) = 1/);
    expect(core).toMatch(/outreach_team_id\s+uuid REFERENCES public\.outreach_teams\(id\)/);
    expect(core).toMatch(/WHEN 'outreach_team'\s+THEN outreach_team_id IS NOT NULL/);
    expect(core).toMatch(/CHECK \(role IN \('owner', 'editor', 'viewer'\)\)/);
    expect(core).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS budget_members_one_responsible_owner\s+ON public\.budget_members \(budget_id\)\s+WHERE role = 'owner'/);
    expect(core).toMatch(/A budget has one responsible owner/);
    expect(core).not.toMatch(/CREATE TABLE public\.budget_repayments|CREATE TABLE public\.budget_xero_spends/);
  });

  it("codes one org per line and does not map a ministry name onto a finance project", () => {
    expect(core).toMatch(/CONSTRAINT budget_line_coding_one_org UNIQUE\(line_id\)/);
    expect(core).toMatch(/CONSTRAINT budget_template_line_coding_one_org UNIQUE\(template_line_id\)/);
    expect(core).toMatch(/Coding must use the budget\/template org/);
    expect(joined).not.toMatch(/finance_projects/);
    expect(joined).not.toMatch(/outreach_team_budgets|outreach_budget_lines|public\.outreach_expenses/);
  });

  it("keeps the six workbook sections, with lines only on variable and fixed", () => {
    for (const key of ["overview", "dashboard", "variable", "fixed", "expense_tracker", "notes"]) {
      expect(core).toContain(`'${key}'`);
    }
    expect(core).toMatch(/holds_lines\s+boolean GENERATED ALWAYS AS \(key IN \('fixed', 'variable'\)\) STORED/);
    expect(core).toMatch(/NEW\.line_total_cents := round\(NEW\.amount_cents \* NEW\.frequency \* NEW\.multiplier\)::bigint;/);
  });

  it("stores the sheet expense tracker only, with no Xero or outreach posting columns", () => {
    expect(expenses).toMatch(/CREATE TABLE public\.budget_expenses/);
    expect(expenses).toMatch(/line_id uuid/);
    expect(expenses).toMatch(/expense_date date NOT NULL/);
    expect(expenses).toMatch(/vendor text/);
    expect(expenses).toMatch(/description text NOT NULL/);
    expect(expenses).toMatch(/amount_cents bigint NOT NULL CHECK\(amount_cents<>0\)/);
    expect(expenses).toMatch(/created_by uuid/);
    expect(expenses).toMatch(/archived_at timestamptz/);
    expect(expenses).toMatch(/FOREIGN KEY\(line_id,budget_id\)\s+REFERENCES public\.budget_lines\(id,budget_id\)/);
    expect(expenses).toMatch(/Not a Xero ledger/);
    expect(expenses).not.toMatch(/\bcurrency\s+text\b/);
    expect(expenses).not.toMatch(/budget_line_id|spent_on|purchaser_user_id|has_receipt|xero_bank_transaction_id|xero_status|outreach_expense_id|receipt_draft_id/);
    expect(expenses).not.toMatch(/storage\.|receipt/i);
    expect(joined).not.toMatch(/CREATE TABLE public\.budget_repayments|CREATE TABLE public\.budget_xero_spends/);
    expect(joined).not.toMatch(/INSERT INTO public\.outreach_expenses|FROM public\.outreach_expenses/);
    expect(expenses).not.toMatch(/expense_date NOT BETWEEN/);
    expect(expenses).toMatch(/v_archive_only OR l\.archived_at IS NULL/);
    expect(expenses).toMatch(/b\.status <> 'archived'/);
    expect(core).not.toMatch(/Outreach retains its existing budget model|Outreach teams keep their own budget/);
    expect(core).toMatch(/REFERENCES public\.users\(id\) ON DELETE RESTRICT/);
    expect(core).toMatch(/status IN \('draft', 'submitted', 'approved', 'archived'\)/);
    expect(core).toMatch(/SELECT p\.org_id INTO v_org/);
    expect(views).toMatch(/CREATE VIEW public\.v_budget_expense_tracker/);
    expect(views).toMatch(/CREATE VIEW public\.v_budget_overview/);
    expect(views).toMatch(/WHEN sb\.id IS NOT NULL AND sb\.org_id=b\.org_id AND sb\.currency=b\.currency/);
  });

  it("leaves the audit log append-only, including for service_role", () => {
    expect(foundation).toMatch(
      /REVOKE INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE ON public\.finance_audit_log FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/
    );
    expect(all[4].code).toMatch(
      /REVOKE INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE ON public\.finance_audit_log FROM service_role;/
    );
  });
});
