import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LEAVE_DAY_PARTS,
  LEAVE_DEFAULT_ALLOWANCES,
  LEAVE_DEFAULT_TYPE_SLUGS,
  LEAVE_END_PARTS,
  LEAVE_ERROR_CODES,
  LEAVE_REQUEST_STATUSES,
  LEAVE_START_PARTS,
  LEAVE_TYPE_SLUG_PATTERN,
} from "./db.types";

// Migration 421 is applied by hand. CI does not start Postgres; the RLS
// and constraint checks run on a throwaway Postgres 17 (see the PR). These
// pin the SQL and keep the TS enums in step with its CHECKs.

const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/421_people_manager_leave.sql"),
  "utf8",
);
const rollback = readFileSync(
  path.join(ROOT, "supabase/rollbacks/421_people_manager_leave_rollback.sql"),
  "utf8",
);
const code = migration.replace(/--.*$/gm, "");

function quoted(list: readonly string[]): string {
  return list.map((v) => `'${v}'`).join(", ");
}

function squash(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("migration 421 people manager", () => {
  it("does not mention a live Supabase project", () => {
    expect(migration + rollback).not.toMatch(/\.supabase\.co/);
    expect(migration + rollback).not.toMatch(/\b[a-z]{20}\b/);
  });

  it("names no department and keys everything on staff_ministries", () => {
    expect(code).not.toMatch(/prayer_and_worship|'media'|'hulk'|slug = '/);
    expect(code).toMatch(
      /department_id\s+uuid NOT NULL REFERENCES public\.staff_ministries \(id\)/,
    );
  });

  it("keeps the TS enums in step with the CHECKs", () => {
    const sql = squash(code);
    expect(sql).toContain(`status IN (${quoted(LEAVE_REQUEST_STATUSES)})`);
    expect(sql).toContain(`start_part IN (${quoted(LEAVE_DAY_PARTS)})`);
    expect(sql).toContain(`end_part IN (${quoted(LEAVE_DAY_PARTS)})`);
    expect(sql).toContain(
      `start_part IN (${quoted(LEAVE_START_PARTS)}) AND end_part IN (${quoted(LEAVE_END_PARTS)})`,
    );
    expect(sql).toContain(`slug ~ '${LEAVE_TYPE_SLUG_PATTERN.source}'`);
  });

  it("seeds Jack's six base defaults with their guideline days", () => {
    const seed = squash(migration.split("6. Seed")[1] ?? "");
    for (const slug of LEAVE_DEFAULT_TYPE_SLUGS) {
      const days = LEAVE_DEFAULT_ALLOWANCES[slug];
      expect(seed).toMatch(
        new RegExp(
          `\\(NULL, '${slug}', '[^']+', \\d+, ${days === null ? "NULL" : days}\\)`,
        ),
      );
    }
    expect(seed).toContain(
      "ON CONFLICT (slug) WHERE department_id IS NULL DO NOTHING",
    );
  });

  it("raises every error code the TS map lists, with its SQLSTATE", () => {
    for (const [name, state] of Object.entries(LEAVE_ERROR_CODES)) {
      expect(squash(code)).toMatch(
        new RegExp(`RAISE EXCEPTION '${name}' USING ERRCODE = '${state}'`),
      );
    }
    const raised = [...code.matchAll(/RAISE EXCEPTION '(leave_\w+)'/g)].map(
      (m) => m[1],
    );
    expect(new Set(raised)).toEqual(new Set(Object.keys(LEAVE_ERROR_CODES)));
  });

  it("revokes every helper from PUBLIC and anon, with an empty search_path", () => {
    const bodies = code.split("CREATE OR REPLACE FUNCTION").slice(1);
    expect(bodies.length).toBeGreaterThan(15);
    for (const body of bodies) {
      const name = body.match(/public\.(\w+)\(/)?.[1];
      expect(body, name).toMatch(/SET search_path = ''/);
      const guard =
        name === "leave_requests_guard" || name === "leave_blockouts_guard";
      if (guard) expect(body, name).not.toMatch(/SECURITY DEFINER/);
      else expect(body, name).toMatch(/SECURITY DEFINER/);
      const revoked =
        new RegExp(`'public\\.${name}\\(`).test(code) ||
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon`,
        ).test(code);
      expect(revoked, name).toBe(true);
    }
  });

  it("enables RLS on every table and uses a security invoker view", () => {
    for (const t of [
      "leave_types",
      "leave_declared_holidays",
      "leave_requests",
      "leave_blockouts",
    ]) {
      expect(code).toContain(`'${t}'`);
      expect(code).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`),
      );
    }
    expect(code).toContain("ENABLE ROW LEVEL SECURITY");
    expect(code).toMatch(
      /VIEW public\.leave_balances\s+WITH \(security_invoker = true\)/,
    );
    expect(code).toContain(
      "REVOKE DELETE ON public.leave_requests FROM authenticated",
    );
  });

  it("reuses 318's helpers and 365's holiday rules", () => {
    expect(code).toContain("public.dept_is_ministry_member(department_id)");
    expect(code).toContain("public.dept_is_ministry_leader(p_department_id)");
    expect(code).toContain("public.sa_public_holiday(p_day)");
    expect(code).not.toMatch(/FUNCTION public\.sa_public_holiday/);
    const rollbackCode = rollback.replace(/--.*$/gm, "");
    expect(rollbackCode).not.toMatch(/sa_public_holiday|easter_sunday|dept_/);
  });

  it("never selects whole users rows", () => {
    expect(migration + rollback).not.toMatch(
      /SELECT\s+\*\s+FROM\s+public\.users/i,
    );
    expect(migration + rollback).not.toMatch(/\bu\.\*/);
  });

  it("guards the rollback and drops everything 421 adds", () => {
    expect(rollback).toContain("people_manager.rollback_drops_leave");
    expect(rollback).toMatch(/ERRCODE = '55000'/);
    const fns = [
      ...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((m) => m[1]);
    for (const fn of fns)
      expect(rollback, fn).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`);
    for (const t of [
      "leave_types",
      "leave_declared_holidays",
      "leave_requests",
      "leave_blockouts",
    ])
      expect(rollback).toContain(`DROP TABLE IF EXISTS public.${t};`);
    expect(rollback).toContain("DROP VIEW IF EXISTS public.leave_balances;");
  });
});
