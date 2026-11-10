import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migrations 317–320 are applied by hand. CI does not start Postgres, so
// these checks pin the SQL the RLS script actually runs.

const ROOT = path.resolve(__dirname, "../../..");

function sql(name: string): string {
  return readFileSync(path.join(ROOT, "supabase/migrations", name), "utf8");
}

const homes = sql("317_department_homes.sql");
const services = sql("318_department_services.sql");
const rocks = sql("319_ministry_rocks.sql");
const budgets = sql("320_department_budgets.sql");
const all = [homes, services, rocks, budgets].join("\n");

describe("departments migrations 317–320", () => {
  it("does not mention the live Supabase project", () => {
    expect(all).not.toContain("thodakhvkcodfystnkxa");
  });

  it("does not delete ministry memberships", () => {
    expect(all).not.toMatch(/DELETE\s+FROM\s+public\.staff_ministry_members/i);
  });

  it("leaves HULC and Missio as updates, not new rows", () => {
    expect(homes).toMatch(/slug IN \('hulk', 'missio_ministry'\)/);
    expect(homes).not.toMatch(/INSERT INTO public\.staff_ministries[\s\S]*'hulk'/);
    expect(homes).not.toMatch(/INSERT INTO public\.staff_ministries[\s\S]*'missio_ministry'/);
    expect(homes).toMatch(/SET cluster = 'outward'[\s\S]*slug = 'hulk'[\s\S]*cluster IS NULL/);
    expect(homes).toMatch(/SET cluster = 'alongside'[\s\S]*slug = 'missio_ministry'[\s\S]*cluster IS NULL/);
  });

  it("folds donors_dev through parent_id and an alias", () => {
    expect(homes).toMatch(/d\.slug = 'donors_dev'/);
    expect(homes).toMatch(/f\.slug = 'finances_legal'/);
    expect(homes).toMatch(/INSERT INTO public\.staff_ministry_aliases/);
    expect(homes).toMatch(/d\.parent_id IS NULL/);
  });

  it("records Philip only when that user id exists", () => {
    expect(homes).toContain("ac7d1c5e-4300-422f-9fad-d50c29a15ca6");
    expect(homes).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.users u\s*WHERE u\.id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'/);
    expect(homes).toMatch(/'be_free', 'part_time'/);
    expect(homes).toMatch(/slug = 'be-free'/);
    expect(homes).toMatch(/m\.staff_ministry_id IS NULL/);
  });

  it("enables RLS on every new table and uses security invoker views", () => {
    for (const table of [
      "staff_ministry_aliases",
      "services",
      "service_owners",
      "rocks",
      "department_budget_links",
    ]) {
      expect(all).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    }
    expect(all).toMatch(/VIEW public\.leadership_ministry_rollup\s*WITH \(security_invoker = true\)/);
    expect(all).toMatch(/VIEW public\.staff_ministry_resolution\s*WITH \(security_invoker = true\)/);
    expect(all).toMatch(/VIEW public\.ministry_service_access\s*WITH \(security_invoker = true\)/);
  });

  it("seeds own and manage, and leaves evangelism use without a grant row", () => {
    expect(services).toContain("'/bookings/equipment'");
    expect(services).toContain("'/bookings/spaces'");
    expect(services).toContain("'/bookings/vehicles'");
    expect(services).toContain("'/communications'");
    expect(services).toContain("'/contacts'");
    expect(services).toContain("'/evangelism'");
    expect(services).toContain("'/prayer-room'");
    expect(services).toContain("'/brand-kit'");
    expect(services).toMatch(/'gear_hire',\s*'prayer_and_worship',\s*'own'/);
    expect(services).toMatch(/'gear_hire',\s*'media',\s*'manage'/);
    expect(services).toMatch(/'communications',\s*'media',\s*'own'/);
    expect(services).toMatch(/'communications',\s*'hulk',\s*'use'/);
    expect(services).toMatch(/'communications',\s*'leadership_team',\s*'use'/);
    expect(services).toMatch(/'contacts',\s*NULL,\s*'use',\s*'leader',\s*true/);
    expect(services).toMatch(/'evangelism',\s*'media',\s*'moderate',\s*NULL/);
    expect(services).toMatch(/'evangelism',\s*'hulk',\s*'moderate',\s*NULL/);
    expect(services).toMatch(/'evangelism',\s*'hulk',\s*'own'/);
    expect(services).not.toMatch(/\('evangelism',\s*NULL/);
    expect(services).toMatch(/p_service_key = 'evangelism'/);
    expect(services).toMatch(/capability IN \('manage', 'use', 'moderate', 'own'\)/);
  });

  it("keeps rocks off the OKR tables and budgets in cents", () => {
    expect(rocks).toMatch(/CREATE TABLE IF NOT EXISTS public\.rocks \(/);
    expect(rocks).toMatch(/quarter\s+text NOT NULL CHECK \(quarter ~ '\^\[0-9\]\{4\}-Q\[1-4\]\$'\)/);
    expect(rocks).toMatch(/status IN \('on_track', 'off_track', 'done'\)/);
    expect(rocks).toMatch(/due_on\s+date/);
    expect(rocks).not.toMatch(/CREATE TABLE[^;]*okr_/);
    expect(rocks).toMatch(/JOIN public\.okr_objectives/);
    expect(rocks).toMatch(/c\.is_current/);
    expect(budgets).toMatch(/CREATE TABLE IF NOT EXISTS public\.department_budget_links/);
    expect(budgets).toMatch(/budget_cents\s+bigint/);
    expect(budgets).toMatch(/spend_cents\s+bigint/);
    expect(budgets).toMatch(/DEFAULT 'ZAR'/);
    expect(budgets).toMatch(/EXTRACT\(YEAR FROM CURRENT_DATE\)/);
    expect(budgets).toMatch(/lower\(btrim\(fp\.name\)\) = lower\(btrim\(sm\.name\)\)/);
    expect(budgets).toMatch(/dept_holds_unscoped_permission\('finance\.view'\)/);
    expect(budgets).toMatch(/slug = 'finances_legal'/);
  });

  it("denies inactive callers inside the new helpers", () => {
    expect(homes).toMatch(/u\.is_active IS NOT FALSE/);
    expect(homes).toMatch(/SET search_path = ''/);
  });
});
