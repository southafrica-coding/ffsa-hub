import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 396 is not applied. These checks read the SQL text so the
// mark-read grants and the updated_at trigger can't drift before it is.

const root = path.resolve(__dirname, "../../../..");
const migration = readFileSync(path.join(root, "supabase/migrations/396_missio_whatsapp.sql"), "utf8");
const code = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

describe("396 Missio WhatsApp — mark read and updated_at", () => {
  it("stamps updated_at in a SECURITY DEFINER trigger with an empty search_path", () => {
    const fn = code.match(/CREATE OR REPLACE FUNCTION public\.missio_whatsapp_touch\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/RETURNS trigger/);
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = ''/);
    // It only stamps NEW; it reads and writes no table.
    expect(fn).toMatch(/NEW\.updated_at := now\(\);/);
    expect(fn).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
  });

  it("lets nobody call the trigger function directly", () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.missio_whatsapp_touch\(\) FROM PUBLIC, anon, authenticated;/);
    expect(code).not.toMatch(/GRANT [^;]* ON FUNCTION public\.missio_whatsapp_touch/);
  });

  it("gives pastors UPDATE on unread_count and last_read_at only — never updated_at", () => {
    const updates = [...code.matchAll(/GRANT ([^;]*\bUPDATE\b[^;]*) ON TABLE (public\.missio_whatsapp_\w+) TO (\w+);/g)];
    expect(updates.map((m) => [m[1].trim(), m[2], m[3]])).toEqual([
      ["UPDATE (unread_count, last_read_at)", "public.missio_whatsapp_threads", "authenticated"],
    ]);
    expect(code).not.toMatch(/GRANT[^;]*updated_at[^;]*TO authenticated/);
  });
});
