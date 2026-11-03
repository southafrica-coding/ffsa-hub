import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  INTERNAL_PRODUCT_COLUMNS,
  INTERNAL_UNIT_COLUMNS,
  STORE_PRODUCT_COLUMNS,
  getProductBySlug,
  listProducts,
} from "@/services/equipment";
import { loadStore } from "./storefront";

// The public store (/hire) reads products through the visitor's own client.
// Migration 285 added internal columns (replacement value, Sortly id on
// products; owner label and provenance on units). None of them may reach the
// public site: the store names its columns, never `*`, and 287 limits anon to
// a column list. These checks keep it that way.

const ROOT = path.resolve(__dirname, "../../..");

/** A fake Supabase client that records each query and answers with `rows`. */
function fakeClient(rows: Record<string, unknown[]> = {}) {
  const calls: { table: string; select?: string; eq: [string, unknown][] }[] = [];
  const rpc = async () => ({ data: [], error: null });
  return {
    calls,
    rpc,
    from(table: string) {
      const call = { table, select: undefined as string | undefined, eq: [] as [string, unknown][] };
      calls.push(call);
      const result = { data: rows[table] ?? [], error: null };
      const q: Record<string, unknown> = {
        select(cols: string) {
          call.select = cols;
          return q;
        },
        eq(col: string, v: unknown) {
          call.eq.push([col, v]);
          return q;
        },
        order: () => q,
        in: () => q,
        neq: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
        then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return q;
    },
  };
}

/** Top-level column names in a PostgREST select string (embeds dropped). */
function topLevelColumns(select: string): string[] {
  let depth = 0;
  let cur = "";
  const out: string[] = [];
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((c) => !c.includes("("));
}

const INTERNAL = [...INTERNAL_PRODUCT_COLUMNS, ...INTERNAL_UNIT_COLUMNS] as string[];

describe("store product columns", () => {
  it("leave out every internal column", () => {
    for (const c of INTERNAL) expect(STORE_PRODUCT_COLUMNS as readonly string[]).not.toContain(c);
  });

  it("are all granted to anon by migration 287", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/287_equipment_products_anon_columns.sql"), "utf8");
    const granted = /GRANT SELECT \(([\s\S]*?)\) ON public\.equipment_products TO anon/.exec(sql)![1]
      .split(",")
      .map((c) => c.trim());
    for (const c of STORE_PRODUCT_COLUMNS) expect(granted, c).toContain(c);
  });

  it("are what the listed-products query asks for — never *", async () => {
    const sb = fakeClient();
    await listProducts(sb, { listedOnly: true });
    const select = sb.calls[0].select!;
    expect(select).not.toMatch(/(^|,)\s*\*/);
    expect(new Set(topLevelColumns(select))).toEqual(new Set(STORE_PRODUCT_COLUMNS));
    expect(sb.calls[0].eq).toContainEqual(["is_listed", true]);
  });

  it("are what the item page asks for — never *", async () => {
    const sb = fakeClient();
    await getProductBySlug(sb, "shure-sm58-vocal-microphone");
    const select = sb.calls[0].select!;
    expect(select).not.toMatch(/(^|,)\s*\*/);
    for (const c of INTERNAL) expect(topLevelColumns(select)).not.toContain(c);
  });
});

describe("loadStore", () => {
  it("asks only for listed products, by name, and passes on no internal field", async () => {
    const sb = fakeClient({
      equipment_products: [
        {
          id: "p1",
          slug: "shure-sm58-vocal-microphone",
          name: "Vocal microphone",
          brand: "Shure",
          model: "SM58",
          store_category_id: null,
          is_kit: false,
          is_listed: true,
          price_day_cents: 15000,
          price_weekend_cents: null,
          price_week_cents: null,
          deposit_cents: 0,
          internal_day_cents: 0,
          // Even if a row carried these, the store item must not.
          replacement_value_cents: 123400,
          sortly_sid: "SDJDKT0000",
        },
      ],
    });
    const store = await loadStore(sb, { from: "2026-11-10", to: "2026-11-10" });
    const productCall = sb.calls.find((c) => c.table === "equipment_products")!;
    expect(productCall.eq).toContainEqual(["is_listed", true]);
    expect(productCall.select).not.toMatch(/(^|,)\s*\*/);
    expect(store.items).toHaveLength(1);
    for (const c of INTERNAL) expect(Object.keys(store.items[0])).not.toContain(c);
  });
});

describe("public pages", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(path.join(ROOT, "src/app/(public)/hire"));
  files.push(path.join(ROOT, "src/lib/equipment/storefront.ts"));

  it("found the store's files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never select * or name an internal column", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\.select\(\s*["'`]\s*\*/);
      for (const c of INTERNAL) expect(src, `${f} mentions ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
    }
  });

  it("never read units or the unit-state view directly, except the staff-only preview", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\(\s*["']equipment_units["']/);
      expect(src, f).not.toMatch(/from\(\s*["']equipment_unit_state["']/);
    }
  });
});
