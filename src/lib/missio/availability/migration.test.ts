import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../../..");
const migration = readFileSync(path.join(root, "supabase/migrations/333_missio_volunteer_availability.sql"), "utf8");
const rollback = readFileSync(path.join(root, "supabase/rollbacks/333_missio_volunteer_availability.sql"), "utf8");

function stripSqlComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

const code = stripSqlComments(migration);

describe("333 Missio volunteer availability wall", () => {
  it("is migration 333 and does not create Planning Center link tables", () => {
    expect(path.basename(path.join(root, "supabase/migrations/333_missio_volunteer_availability.sql"))).toBe(
      "333_missio_volunteer_availability.sql"
    );
    expect(code).not.toMatch(/create table[^;]*pco_/i);
  });

  it("does not use is_admin, has_role, or contacts permissions in policy code", () => {
    expect(code).not.toMatch(/is_admin\s*\(/);
    expect(code).not.toMatch(/\bhas_role\s*\(/);
    expect(code).not.toMatch(/has_permission\s*\(/);
    expect(code).not.toMatch(/contacts\.view|contacts\.read/);
    expect(code).toMatch(/has_org_role\('missio', ARRAY\['pastor'\]\)/);
  });

  it("keeps availability tokens service-role only and hash-only", () => {
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.availability_tokens FROM PUBLIC, anon, authenticated/);
    expect(code).not.toMatch(/CREATE POLICY[\s\S]*?ON public\.availability_tokens/);
    expect(code).toMatch(/token_hash\s+text NOT NULL CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(code).not.toMatch(/\btoken\s+text\b/);
    const grants = code.match(/GRANT[\s\S]*?;/g) ?? [];
    for (const grant of grants) {
      expect(grant).not.toMatch(/\banon\b/);
      if (/availability_tokens/.test(grant)) expect(grant).not.toMatch(/\bauthenticated\b/);
      if (/availability_responses/.test(grant) && /authenticated/.test(grant)) {
        expect(grant).toMatch(/GRANT SELECT ON TABLE public\.availability_responses TO authenticated/);
      }
    }
  });

  it("revokes anon from every new table", () => {
    for (const table of [
      "missio_teams",
      "missio_team_leaders",
      "missio_team_members",
      "availability_requests",
      "availability_tokens",
      "availability_responses",
    ]) {
      expect(code).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`));
    }
  });

  it("sets an empty search_path on every security definer function", () => {
    const functions = code.split(/CREATE OR REPLACE FUNCTION/).slice(1);
    const definers = functions.filter((fn) => /SECURITY DEFINER/.test(fn.split("AS $$")[0] ?? fn));
    expect(definers.length).toBeGreaterThanOrEqual(3);
    for (const fn of definers) {
      expect(fn).toMatch(/SET search_path = ''/);
    }
  });

  it("references contacts(id) for members and leaders", () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.missio_team_members \([\s\S]*contact_id uuid NOT NULL REFERENCES public\.contacts \(id\)/);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.missio_team_leaders \([\s\S]*contact_id uuid NOT NULL REFERENCES public\.contacts \(id\)/);
  });

  it("closes answers once the Johannesburg service date has passed", () => {
    expect(code).toMatch(/NEW\.service_date < \(pg_catalog\.timezone\('Africa\/Johannesburg', pg_catalog\.now\(\)\)\)::date/);
    expect(code).toMatch(/status IN \('available', 'unavailable', 'maybe'\)/);
  });

  it("stamps created_by from auth.uid and rejects a contact who is not on a roster", () => {
    expect(code).toMatch(/NEW\.created_by := auth\.uid\(\)/);
    expect(code).toMatch(/NEW\.created_by := OLD\.created_by/);
    expect(code).toMatch(/RAISE EXCEPTION 'missio_contact_not_in_org'/);
    expect(code).toMatch(/CREATE TRIGGER trg_availability_tokens_roster/);
    expect(code).toMatch(/CREATE TRIGGER trg_availability_responses_roster/);
    expect(code).not.toMatch(/CREATE POLICY "Missio pastors manage availability requests"/);
    expect(code).toMatch(/FOR INSERT/);
    expect(code).not.toMatch(/FOR UPDATE\s+TO authenticated[\s\S]*availability_requests/);
  });

  it("rolls back only the objects this migration creates", () => {
    for (const table of [
      "availability_responses",
      "availability_tokens",
      "availability_requests",
      "missio_team_members",
      "missio_team_leaders",
      "missio_teams",
    ]) {
      expect(rollback).toMatch(new RegExp(`DROP TABLE IF EXISTS public\\.${table}`));
    }
    const rollbackCode = stripSqlComments(rollback);
    expect(rollbackCode).not.toMatch(/DROP (TABLE|FUNCTION)[^;]*(organisations|org_people|contacts)/);
  });
});
