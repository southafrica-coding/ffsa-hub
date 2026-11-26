import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 413 isn't applied anywhere yet. Like migration-rls.test.ts for
// 412, these read the SQL so the coupon access model can't drift: buyers
// read nothing, staff can't write used_count, the use is taken by a locked,
// service-role-only function, and the migration adds no rows.
const root = path.resolve(__dirname, "../../../..");
const sql = readFileSync(path.join(root, "supabase/migrations/413_store_coupons.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");
const TABLES = ["store_coupons", "store_coupon_redemptions", "store_coupon_audit"];
const policies = [...code.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.(\w+) FOR (\w+) TO ([\w, ]+)\s+(USING|WITH CHECK)\s*\(([\s\S]*?)\);/g)].map((m) => ({ name: m[1], table: m[2], cmd: m[3], to: m[4], body: m[6] }));
const fn = (name: string) => code.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] ?? "";

describe("413 Store coupons migration", () => {
  it("is the only 413, one transaction, and says it isn't applied", () => {
    const files = readdirSync(path.join(root, "supabase/migrations"));
    expect(files.filter((f) => f.startsWith("413_"))).toEqual(["413_store_coupons.sql"]);
    expect(code.trim().startsWith("BEGIN;")).toBe(true);
    expect(code.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toMatch(/NOT APPLIED\. Vercel previews share the production database/);
    expect(sql).toMatch(/Jack's call/);
  });

  it("adds no rows: no coupons, orders, users or permissions", () => {
    // The only INSERTs are inside function bodies (the audit trigger and the
    // apply function), never a data row at the top level.
    const inserts = [...code.matchAll(/INSERT INTO ([\w.]+)/gi)].map((m) => m[1]).sort();
    expect(inserts).toEqual(["public.store_coupon_audit", "public.store_coupon_redemptions"]);
    const topLevel = code.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(topLevel).not.toMatch(/INSERT INTO/i);
    expect(topLevel).not.toMatch(/\bUPDATE public\.store_(coupons|orders)\s+SET/i);
  });

  it("is idempotent: IF NOT EXISTS, OR REPLACE, DROP ... IF EXISTS before every policy and trigger", () => {
    for (const t of TABLES) expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
    expect(code).not.toMatch(/CREATE FUNCTION/);
    for (const p of policies) expect(code).toContain(`DROP POLICY IF EXISTS "${p.name}" ON public.${p.table};`);
    for (const m of code.matchAll(/CREATE TRIGGER (\w+)\s+\w+ [\w ]+ ON (public\.\w+)/g)) {
      expect(code).toContain(`DROP TRIGGER IF EXISTS ${m[1]} ON ${m[2]};`);
    }
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS coupon_id/);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0/);
  });

  it("codes are upper case and human-shaped; exactly one discount; used never passes max", () => {
    expect(code).toMatch(/code = upper\(code\) AND length\(code\) BETWEEN 3 AND 40/);
    expect(code).toMatch(/percent_off BETWEEN 1 AND 100/);
    expect(code).toMatch(/amount_off_cents > 0/);
    expect(code).toMatch(/\(percent_off IS NULL\) <> \(amount_off_cents IS NULL\)/);
    expect(code).toMatch(/max_uses IS NULL OR used_count <= max_uses/);
    expect(code).toMatch(/UNIQUE INDEX IF NOT EXISTS store_coupons_code_idx ON public\.store_coupons \(code\)/);
    expect(code).toMatch(/UNIQUE \(order_id\)/);
  });

  it("orders: total takes the discount off, 'free' is a method, and a free order is only paid at R0 with a coupon", () => {
    expect(code).toMatch(/store_orders_total_check\s+CHECK \(total_cents = subtotal_cents \+ delivery_cents - discount_cents\)/);
    expect(code).toMatch(/payment_method IN \('payfast', 'eft', 'stripe', 'free'\)/);
    expect(code).toMatch(/discount_cents <= subtotal_cents/);
    expect(code).toMatch(/payment_method <> 'free' OR status <> 'paid' OR \(total_cents = 0 AND coupon_id IS NOT NULL\)/);
    // 412's unnamed checks are found by definition and dropped first.
    expect(code).toMatch(/pg_get_constraintdef[\s\S]*DROP CONSTRAINT %I/);
  });

  it("buyers read nothing: staff-only policies, no anon grants", () => {
    for (const t of TABLES) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
      for (const p of policies.filter((x) => x.table === t)) {
        expect(p.to.trim()).toBe("authenticated");
        expect(p.body).toMatch(/public\.store_can_(view|manage)\(\)/);
        expect(p.body).not.toMatch(/auth\.uid|store_buyer_email/);
      }
    }
    expect(policies.filter((p) => p.cmd === "DELETE")).toEqual([]);
    expect(policies.find((p) => p.table === "store_coupons" && p.cmd === "INSERT")?.body).toMatch(/store_can_manage/);
    expect(policies.find((p) => p.table === "store_coupons" && p.cmd === "UPDATE")?.body).toMatch(/store_can_manage/);
    expect(policies.filter((p) => p.table !== "store_coupons").map((p) => p.cmd)).toEqual(["SELECT", "SELECT"]);
    expect(code).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.store_coupons, public\.store_coupon_redemptions, public\.store_coupon_audit\s+FROM PUBLIC, anon, authenticated;/);
  });

  it("staff write only the fields a person sets: never used_count, created_by or timestamps", () => {
    const grants = [...code.matchAll(/GRANT (INSERT|UPDATE) \(([^)]+)\)\s+ON TABLE public\.store_coupons TO authenticated;/g)];
    expect(grants.map((g) => g[1]).sort()).toEqual(["INSERT", "UPDATE"]);
    for (const g of grants) {
      expect(g[2]).not.toMatch(/used_count|created_by|created_at|updated_at|\bid\b/);
    }
    expect(code).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^(]*ON TABLE[^;]*store_coupon(_redemptions|_audit)?[^;]*TO authenticated/);
  });

  it("store_apply_coupon: service role only, locks the coupon, re-checks, takes the use conditionally", () => {
    const body = fn("store_apply_coupon");
    expect(body).toMatch(/SECURITY DEFINER SET search_path = ''/);
    expect(body).toMatch(/FROM public\.store_coupons WHERE code = v_code FOR UPDATE/);
    expect(body).toMatch(/FROM public\.store_orders WHERE id = p_order_id FOR UPDATE/);
    for (const reason of ["malformed", "order", "unknown", "inactive", "expired", "used_up", "wrong_product", "changed"]) {
      expect(body).toContain(`'${reason}'`);
    }
    expect(body).toMatch(/SET used_count = used_count \+ 1\s+WHERE id = v_coupon\.id\s+AND \(max_uses IS NULL OR used_count < max_uses\)/);
    expect(body).toMatch(/GET DIAGNOSTICS v_rows = ROW_COUNT/);
    expect(body).toMatch(/INSERT INTO public\.store_coupon_redemptions/);
    expect(body).toMatch(/v_eligible \* v_coupon\.percent_off \/ 100/);
    expect(body).toMatch(/least\(v_coupon\.amount_off_cents::bigint, v_eligible\)/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.store_apply_coupon\(uuid, text, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.store_apply_coupon\(uuid, text, integer\) TO service_role;/);
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.store_apply_coupon[^;]*(anon|authenticated)/);
  });

  it("cancelling or deleting an order gives the use back; a used code's discount is locked; audit stamps auth.uid()", () => {
    expect(code).toMatch(/AFTER UPDATE OF status ON public\.store_orders[\s\S]*?NEW\.status = 'cancelled' AND OLD\.status IS DISTINCT FROM 'cancelled'/);
    expect(code).toMatch(/order_id\s+uuid NOT NULL REFERENCES public\.store_orders \(id\) ON DELETE CASCADE/);
    expect(fn("store_coupon_redemption_released")).toMatch(/SET used_count = used_count - 1\s+WHERE id = OLD\.coupon_id AND used_count > 0/);
    expect(fn("store_coupons_before_write")).toMatch(/store_coupon_locked/);
    expect(fn("store_coupons_audit")).toMatch(/auth\.uid\(\)/);
    for (const f of ["store_coupons_before_write", "store_coupons_audit", "store_coupon_redemption_released", "store_order_cancel_releases_coupon"]) {
      expect(fn(f)).toMatch(/SECURITY DEFINER SET search_path = ''/);
    }
  });
});
