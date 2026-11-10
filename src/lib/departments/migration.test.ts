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
      "ministry_rocks",
      "department_budgets",
      "staff_ministry_finance_projects",
    ]) {
      expect(all).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    }
    expect(all).toMatch(/VIEW public\.leadership_ministry_rollup\s*WITH \(security_invoker = true\)/);
    expect(all).toMatch(/VIEW public\.staff_ministry_resolution\s*WITH \(security_invoker = true\)/);
    expect(all).toMatch(/VIEW public\.ministry_service_access\s*WITH \(security_invoker = true\)/);
  });

  it("seeds service routes and the contacts / evangelism rules", () => {
    expect(services).toContain("'/bookings/equipment'");
    expect(services).toContain("'/bookings/spaces'");
    expect(services).toContain("'/bookings/vehicles'");
    expect(services).toContain("'/communications'");
    expect(services).toContain("'/contacts'");
    expect(services).toContain("'/evangelism'");
    expect(services).toContain("'/prayer-room'");
    expect(services).toContain("'/brand-kit'");
    expect(services).toMatch(/'contacts'[\s\S]*'point_leaders'/);
    expect(services).toMatch(/'evangelism'[\s\S]*'everyone'/);
    expect(services).toMatch(/'evangelism',\s*'media',\s*'moderator'/);
    expect(services).toMatch(/'evangelism',\s*'hulk',\s*'moderator'/);
    expect(services).toMatch(/role IN \('owner', 'access', 'moderator'\)/);
  });

  it("keeps rocks off the OKR tables and budgets in cents", () => {
    expect(rocks).toMatch(/CREATE TABLE IF NOT EXISTS public\.ministry_rocks/);
    expect(rocks).not.toMatch(/CREATE TABLE[^;]*okr_/);
    expect(rocks).toMatch(/JOIN public\.okr_objectives/);
    expect(rocks).toMatch(/c\.is_current/);
    expect(budgets).toMatch(/amount_cents\s+bigint/);
    expect(budgets).toMatch(/lower\(btrim\(fp\.name\)\) = lower\(btrim\(sm\.name\)\)/);
    expect(budgets).toMatch(/dept_holds_unscoped_permission\('finance\.view'\)/);
    expect(budgets).toMatch(/slug = 'finances_legal'/);
  });

  it("denies inactive callers inside the new helpers", () => {
    expect(homes).toMatch(/u\.is_active IS NOT FALSE/);
    expect(homes).toMatch(/SET search_path = ''/);
  });
});
