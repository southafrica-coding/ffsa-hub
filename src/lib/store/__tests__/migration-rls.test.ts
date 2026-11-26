import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { storeStaffLevel } from "../access";

// Migration 412 isn't applied anywhere yet. These checks read its SQL so the
// access model can't drift before it is: RLS on every table, buyers scoped
// to their own rows, staff behind store.manage / store.view, private
// buckets, no fixture rows.
const root = path.resolve(__dirname, "../../../..");
const sql = readFileSync(path.join(root, "supabase/migrations/412_store.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");
const TABLES = ["store_products", "store_variants", "store_assets", "store_asset_pages", "store_orders", "store_order_items", "store_entitlements", "store_codes", "store_devices", "store_fulfilments"];
const policies = [...code.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.(\w+) FOR (\w+) TO ([\w, ]+)\s+(USING|WITH CHECK)\s*\(([\s\S]*?)\);/g)].map((m) => ({ name: m[1], table: m[2], cmd: m[3], to: m[4], body: m[6] }));

describe("412 Store migration", () => {
  it("is the only 412 and one transaction", () => {
    const files = readdirSync(path.join(root, "supabase/migrations"));
    expect(files.filter((f) => f.startsWith("412_"))).toEqual(["412_store.sql"]);
    expect(code.trim().startsWith("BEGIN;")).toBe(true);
    expect(code.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("adds no catalogue, order or user rows — only the permission catalogue and the buckets", () => {
    const inserts = [...code.matchAll(/INSERT INTO ([\w.]+)/gi)].map((m) => m[1]);
    expect(inserts.filter((t) => !/^(public\.store_devices)$/.test(t))).toEqual(["public.permissions", "storage.buckets"]);
    expect(code).toMatch(/\('store', 'store\.manage'/);
    expect(code).toMatch(/\('store', 'store\.view'/);
    expect(code).not.toMatch(/INSERT INTO public\.(user_permissions|role_permissions|user_roles)/);
  });

  it("enables RLS on every Store table, and money is integer cents", () => {
    for (const t of TABLES) {
      expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
    expect(code).not.toMatch(/_cents\s+numeric/);
    expect(code).toMatch(/price_cents\s+integer/);
  });

  it("anonymous visitors read the published catalogue and nothing else", () => {
    const anon = policies.filter((p) => p.to.includes("anon"));
    expect(anon.map((p) => p.table).sort()).toEqual(["store_products", "store_variants"]);
    for (const p of anon) expect(p.cmd).toBe("SELECT");
    expect(code).toMatch(/GRANT SELECT ON TABLE public\.store_products, public\.store_variants TO anon;/);
  });

  it("buyers only ever see rows tied to their own auth uid or verified email", () => {
    for (const t of ["store_orders", "store_order_items", "store_entitlements", "store_codes", "store_fulfilments"]) {
      const select = policies.find((p) => p.table === t && p.cmd === "SELECT")!;
      expect(select.body).toMatch(/store_can_view\(\)/);
      expect(select.body).toMatch(/auth\.uid\(\)/);
      expect(select.body).toMatch(/store_buyer_email\(\)/);
    }
    // Buyers can't write orders, entitlements or codes; those go through the server.
    for (const t of ["store_orders", "store_entitlements", "store_codes", "store_order_items"]) {
      for (const p of policies.filter((x) => x.table === t && x.cmd !== "SELECT")) expect(p.body).toMatch(/store_can_manage\(\)/);
    }
    expect(policies.some((p) => p.table === "store_codes" && p.cmd !== "SELECT")).toBe(false);
  });

  it("staff writes need is_admin() or store.manage", () => {
    expect(code).toMatch(/SELECT public\.is_admin\(\) OR public\.has_permission\('store\.manage'\);/);
    for (const p of policies.filter((x) => ["INSERT", "UPDATE", "DELETE", "ALL"].includes(x.cmd) && x.table !== "store_devices")) {
      expect(p.body).toMatch(/store_can_manage\(\)/);
    }
  });

  it("the stock and device helpers are service-role only", () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.store_take_stock\(uuid, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.store_register_device\(uuid, text, text, integer\) FROM PUBLIC, anon, authenticated;/);
  });

  it("keeps every bucket private", () => {
    const buckets = [...code.matchAll(/\('(store-[a-z]+)',\s*'store-[a-z]+',\s*(true|false)/g)];
    expect(buckets.map((b) => [b[1], b[2]])).toEqual([["store-source", "false"], ["store-pages", "false"], ["store-covers", "false"], ["store-audio", "false"]]);
    expect(code).toMatch(/SET public\s+= false/);
    expect(code).not.toMatch(/ON storage\.objects/);
  });
});

describe("staff vs buyer", () => {
  it("a buyer (no users row, no roles, no grants) is never staff", () => {
    expect(storeStaffLevel({ roles: [], permissionKeys: [], isActive: true })).toBeNull();
  });
  it("store.manage manages, store.view only views; admins manage; inactive accounts get nothing", () => {
    expect(storeStaffLevel({ roles: ["staff"], permissionKeys: ["store.manage"], isActive: true })).toBe("manage");
    expect(storeStaffLevel({ roles: ["staff"], permissionKeys: ["store.view"], isActive: true })).toBe("view");
    expect(storeStaffLevel({ roles: ["admin"], permissionKeys: [], isActive: true })).toBe("manage");
    expect(storeStaffLevel({ roles: ["super_admin"], permissionKeys: [], isActive: false })).toBeNull();
    expect(storeStaffLevel({ roles: ["comms_admin", "events_admin"], permissionKeys: ["brand_kit.view"], isActive: true })).toBeNull();
  });
});
