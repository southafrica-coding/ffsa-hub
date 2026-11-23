import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 397 is not applied. These checks read the SQL text so the
// grants and policies can't drift before it is. The full role matrix is in
// supabase/tests/missio_whatsapp_bot_rls.sql (disposable database only).

const root = path.resolve(__dirname, "../../../../..");
const migration = readFileSync(path.join(root, "supabase/migrations/397_missio_whatsapp_bot.sql"), "utf8");
const code = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

describe("397 Missio WhatsApp bot", () => {
  it("is one transaction and adds no seed rows", () => {
    expect(code.trim().startsWith("BEGIN;")).toBe(true);
    expect(code.trim().endsWith("COMMIT;")).toBe(true);
    expect(code).not.toMatch(/INSERT INTO/i);
  });

  it("doesn't change 396's tables beyond adding columns and constraints", () => {
    expect(code).not.toMatch(/DROP (TABLE|COLUMN)/i);
    expect(code).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.missio_whatsapp_(bump_thread|touch)\b/);
  });

  it("enables RLS and revokes everything first on every new table", () => {
    for (const table of ["missio_whatsapp_bot_sessions", "missio_whatsapp_bot_outbox", "missio_serving_interests"]) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`));
      expect(code).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM PUBLIC, anon, authenticated;`));
    }
    expect(code).not.toMatch(/REVOKE[^;]*service_role/);
  });

  it("grants pastors only what the inbox needs", () => {
    const grants = [...code.matchAll(/GRANT ([^;]+) ON TABLE (public\.\w+)\s+TO (\w+);/g)].map((m) => `${m[1].trim()} | ${m[2]} | ${m[3]}`);
    expect(grants).toEqual([
      "UPDATE (bot_mode, bot_paused_at, bot_paused_by, bot_handoff_reason) | public.missio_whatsapp_threads | authenticated",
      "SELECT | public.missio_whatsapp_bot_sessions | authenticated",
      "SELECT | public.missio_serving_interests | authenticated",
      "UPDATE (status) | public.missio_serving_interests | authenticated",
    ]);
    expect(code).not.toMatch(/TO anon/);
    expect(code).not.toMatch(/GRANT[^;]*(TRUNCATE|REFERENCES|TRIGGER)/);
  });

  it("every policy is for Missio pastors, and the outbox has none", () => {
    const policies = [...code.matchAll(/CREATE POLICY "[^"]+"\s+ON (public\.\w+) FOR (\w+)\s+TO (\w+)\s+USING \(([^)]+\))\)/g)];
    expect(policies.map((p) => `${p[1]} ${p[2]} ${p[3]}`)).toEqual([
      "public.missio_whatsapp_bot_sessions SELECT authenticated",
      "public.missio_serving_interests SELECT authenticated",
      "public.missio_serving_interests UPDATE authenticated",
    ]);
    for (const p of policies) expect(p[4]).toBe("public.has_org_role_id(org_id, ARRAY['pastor'])");
    expect(code).not.toMatch(/ON public\.missio_whatsapp_bot_outbox FOR/);
  });

  it("the bot-mode stamp is SECURITY DEFINER with an empty search_path, and nobody calls it directly", () => {
    const fn = code.match(/CREATE OR REPLACE FUNCTION public\.missio_whatsapp_bot_stamp\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = ''/);
    expect(fn).not.toMatch(/\b(INSERT|DELETE)\b/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.missio_whatsapp_bot_stamp\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it("is safe to re-run", () => {
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    const policies = [...code.matchAll(/CREATE POLICY ("[^"]+") ON (public\.\w+)/g)];
    for (const [, name, table] of policies) expect(code).toContain(`DROP POLICY IF EXISTS ${name} ON ${table};`);
    const triggers = [...code.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE UPDATE ON (public\.\w+)/g)];
    for (const [, name, table] of triggers) expect(code).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${table};`);
  });
});
