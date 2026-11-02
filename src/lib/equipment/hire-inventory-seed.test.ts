import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUT_PATH,
  SORTLY_NOTE,
  buildSeedSql,
  liveProductsFrom256,
  planSeed,
  slugify,
} from "../../../scripts/generate-hire-inventory-seed.mjs";

// The inventory import (migrations 285 / 286 / 287) is applied by hand in the
// Supabase SQL editor, so nothing runs it in CI. These checks read the JSON
// and the SQL and pin down what matters: the data hangs together, the seed
// is exactly what the generator makes, nothing destructive or listing-related
// sneaks in, and the files are safe to run twice.

const ROOT = path.resolve(__dirname, "../../..");
const DIR = path.join(ROOT, "supabase/migrations");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type Unit = {
  tag: string;
  product_key: string;
  location: string | null;
  already_seeded: boolean;
  status: string;
  owner_label: string | null;
};
type SortlyUnit = { tag: string; product_key: string; sortly_row: number };
type Inventory = {
  locations: { slug: string; name: string }[];
  owner_label_to_ministry_slug: Record<string, string>;
  new_products: Record<string, { name: string; brand: string | null; model: string | null; register_category: string }>;
  units: Unit[];
  sortly: { row: number; sid: string | null; action: string }[];
  sortly_only_products: { seed_key: string; sid: string; photo_files: string[] }[];
  sortly_only_units: SortlyUnit[];
  product_value_updates: Record<string, { replacement_value_cents: number; sortly_sid: string | null; photo_files: string[] }>;
  not_imported: { sid: string }[];
};

const data = JSON.parse(read("data/hire-inventory/hire-inventory.json")) as Inventory;
const seed256 = read("supabase/migrations/256_equipment_seed_auditorium.sql");
const live = liveProductsFrom256(seed256) as Map<string, string>;
const schema = read("supabase/migrations/285_equipment_inventory_fields.sql");
const seed = read(OUT_PATH);
const anonCols = read("supabase/migrations/287_equipment_products_anon_columns.sql");

/** SQL statements, comments stripped. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sheetUnits = data.units.filter((u) => !u.already_seeded);
const newProductKeys = Object.keys(data.new_products);
const sortlyKeys = data.sortly_only_products.map((p) => p.seed_key);

describe("hire-inventory.json", () => {
  it("has the counts the import was planned around", () => {
    expect(data.units).toHaveLength(128);
    expect(data.units.filter((u) => u.already_seeded)).toHaveLength(95);
    expect(sheetUnits).toHaveLength(33);
    expect(data.sortly_only_units).toHaveLength(25);
    expect(data.sortly_only_products).toHaveLength(10);
  });

  it("knows the 28 products 256 put live", () => {
    expect(live.size).toBe(28);
    expect(live.has("sm58")).toBe(true);
  });

  it("has unique tags across sheet and Sortly units", () => {
    const tags = [...data.units.map((u) => u.tag), ...data.sortly_only_units.map((u) => u.tag)];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("has no tag format surprises", () => {
    const formats = [/^AUD-\d{4}$/, /^AUX-\d{4}$/, /^STU\d{4}$/, /^UCL\d{4}$/, /^SBS-\d{4}$/, /^DBS-\d{4}$/];
    for (const u of data.units) expect(formats.some((f) => f.test(u.tag)), u.tag).toBe(true);
    for (const u of sheetUnits) expect(/^(AUD|AUX)-/.test(u.tag), u.tag).toBe(false);
    for (const u of data.units.filter((x) => x.already_seeded)) expect(/^(AUD|AUX)-/.test(u.tag), u.tag).toBe(true);
    for (const u of data.sortly_only_units) expect(u.tag).toMatch(/^SRT-\d{4}-\d{2}$/);
  });

  it("resolves every product_key to a new, Sortly-only or live product", () => {
    const known = new Set([...newProductKeys, ...sortlyKeys, ...live.keys()]);
    for (const u of [...data.units, ...data.sortly_only_units]) expect(known.has(u.product_key), u.tag).toBe(true);
    for (const k of Object.keys(data.product_value_updates)) expect(known.has(k), k).toBe(true);
  });

  it("never re-creates a live product", () => {
    for (const k of [...newProductKeys, ...sortlyKeys]) expect(live.has(k), k).toBe(false);
    expect(Object.keys(data.product_value_updates)).not.toContain("sm58");
  });

  it("puts every unit in a known location", () => {
    const slugs = new Set(["auditorium", ...data.locations.map((l) => l.slug)]);
    for (const u of data.units) {
      if (u.location) expect(slugs.has(u.location), u.tag).toBe(true);
    }
  });

  it("maps every owner label to a ministry slug", () => {
    for (const u of data.units) {
      if (u.owner_label) expect(data.owner_label_to_ministry_slug[u.owner_label], u.tag).toBeTruthy();
    }
  });

  it("only uses statuses the units table allows", () => {
    for (const u of data.units) expect(["available", "maintenance", "retired"]).toContain(u.status);
  });

  it("names every photo file that is in the repo", () => {
    const files = new Set(readdirSync(path.join(ROOT, "data/hire-inventory/photos")));
    const named = [
      ...Object.values(data.product_value_updates).flatMap((v) => v.photo_files),
      ...data.sortly_only_products.flatMap((p) => p.photo_files),
    ];
    expect(named).toHaveLength(15);
    for (const f of named) expect(files.has(f), f).toBe(true);
  });

  it("leaves the unnamed Sortly row out", () => {
    const skipped = data.sortly.filter((r) => r.action === "skip_unnamed");
    expect(skipped.map((r) => r.sid)).toEqual(data.not_imported.map((r) => r.sid));
    for (const r of skipped) expect(seed).not.toContain(String(r.sid));
  });
});

describe("generator", () => {
  it("slugs the way 256 did", () => {
    const rows = [...seed256.matchAll(/\('([^']+)', '([^']+)', (NULL|'[^']*'), (NULL|'[^']*'), '[a-z]+', '([a-z0-9-]+)'\)/g)];
    expect(rows).toHaveLength(28);
    const un = (v: string) => (v === "NULL" ? null : v.slice(1, -1));
    for (const m of rows) expect(slugify(un(m[3]), un(m[4]), m[2])).toBe(m[5]);
  });

  it("gives every new product a slug that collides with nothing", () => {
    const plan = planSeed(data, live);
    const slugs = [...plan.newProducts, ...plan.sortlyProducts].map((p: { slug: string }) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect([...live.values()]).not.toContain(s);
  });

  it("refuses an unknown product key", () => {
    const bad = { ...data, units: [...data.units, { ...sheetUnits[0], tag: "UCL9999", product_key: "nope" }] };
    expect(() => buildSeedSql(bad, seed256)).toThrow(/unknown product_key/);
  });
});

describe("migration 286 (generated seed)", () => {
  it("is exactly what the generator makes from the JSON", () => {
    expect(seed).toBe(buildSeedSql(data, seed256));
  });

  it("says it is generated, by what, from what", () => {
    expect(seed).toMatch(/GENERATED by scripts\/generate-hire-inventory-seed\.mjs/);
    expect(seed).toContain("data/hire-inventory/hire-inventory.json");
  });

  it("states the expected end state, computed from the JSON", () => {
    const sheet = sheetUnits.length;
    const sortly = data.sortly_only_units.length;
    const before = data.units.length - sheet;
    expect(seed).toContain(`+${sheet} sheet units, +${sortly} unverified Sortly units = +${sheet + sortly} (${before} -> ${before + sheet + sortly})`);
    const products = newProductKeys.length + data.sortly_only_products.length;
    expect(seed).toContain(`= +${products} (${live.size} -> ${live.size + products})`);
  });

  it("inserts every new unit and product, and nothing already live", () => {
    for (const u of [...sheetUnits, ...data.sortly_only_units]) expect(seed).toContain(`'${u.tag}'`);
    for (const u of data.units.filter((x) => x.already_seeded)) expect(seed).not.toContain(`'${u.tag}'`);
    for (const k of [...newProductKeys, ...sortlyKeys]) expect(seed).toContain(`('${k}', `);
  });

  it("is one transaction", () => {
    const st = statements(seed);
    expect(st[0]).toBe("BEGIN");
    expect(st[st.length - 1]).toBe("COMMIT");
  });

  it("has no DROP, DELETE, TRUNCATE or ALTER", () => {
    for (const s of statements(seed)) expect(s).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE|ALTER)\b/i);
    expect(statements(seed).join("\n")).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });

  it("guards every INSERT with ON CONFLICT or NOT EXISTS", () => {
    const inserts = statements(seed).filter((s) => /^INSERT\b/i.test(s));
    expect(inserts.length).toBeGreaterThanOrEqual(6);
    for (const s of inserts) expect(/ON CONFLICT|NOT EXISTS/i.test(s), s.slice(0, 80)).toBe(true);
  });

  it("only UPDATEs replacement_value_cents and sortly_sid, and only where still NULL", () => {
    const updates = statements(seed).filter((s) => /^UPDATE\b/i.test(s));
    expect(updates).toHaveLength(Object.keys(data.product_value_updates).length);
    for (const s of updates) {
      expect(s).toMatch(/^UPDATE public\.equipment_products SET replacement_value_cents = \d+(, sortly_sid = coalesce\(sortly_sid, '[A-Z0-9]+'\))? WHERE seed_key = '[a-z0-9]+' AND replacement_value_cents IS NULL$/);
    }
  });

  it("never lists, prices or lets anything leave the building", () => {
    expect(seed).not.toMatch(/is_listed\s*=\s*true/i);
    expect(seed).not.toMatch(/store_category_id/);
    for (const s of statements(seed).filter((x) => /^INSERT INTO public\.equipment_products/.test(x))) {
      expect(s).toContain("is_listed, price_day_cents, can_leave_building");
      expect(s).toContain("false, NULL, false");
    }
  });

  it("does not mention the listed SM58", () => {
    expect(seed).not.toMatch(/sm58/i);
  });

  it("marks the Sortly units unverified, with no location or owner", () => {
    expect(seed).toContain("'unverified', true");
    expect(seed).toContain(SORTLY_NOTE.replace(/'/g, "''"));
  });

  it("sorts after the schema migration it needs", () => {
    expect(path.basename(OUT_PATH) > "285_equipment_inventory_fields.sql").toBe(true);
  });
});

describe("migration 285 (schema)", () => {
  const st = statements(schema);

  it("is one transaction", () => {
    expect(st[0]).toBe("BEGIN");
    expect(st[st.length - 1]).toBe("COMMIT");
  });

  it("is additive only", () => {
    const body = st.join("\n");
    expect(body).not.toMatch(/\b(DROP|DELETE|TRUNCATE|RENAME|REVOKE)\b/i);
    expect(body).not.toMatch(/ALTER\s+COLUMN/i);
    for (const s of st.filter((x) => /^ALTER TABLE/i.test(x))) expect(s).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  it("adds the four columns", () => {
    expect(schema).toMatch(/equipment_units\s+ADD COLUMN IF NOT EXISTS owner_label text/);
    expect(schema).toMatch(/equipment_units\s+ADD COLUMN IF NOT EXISTS source jsonb/);
    expect(schema).toMatch(/equipment_products\s+ADD COLUMN IF NOT EXISTS replacement_value_cents integer/);
    expect(schema).toMatch(/replacement_value_cents IS NULL OR replacement_value_cents >= 0/);
    expect(schema).toMatch(/equipment_products\s+ADD COLUMN IF NOT EXISTS sortly_sid text/);
  });

  it("adds the JSON's locations idempotently", () => {
    for (const l of data.locations) {
      expect(schema).toContain(`'${l.name}'`);
      expect(schema).toContain(`'${l.slug}'`);
    }
    expect(schema).toMatch(/ON CONFLICT \(slug\) DO NOTHING/);
  });

  it("only backfills owner_label on the live Auditorium units, and only when NULL", () => {
    const updates = st.filter((s) => /^UPDATE/i.test(s));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/SET owner_label = 'Prayer & Worship Ministry'/);
    expect(updates[0]).toMatch(/WHERE owner_label IS NULL/);
    expect(updates[0]).toMatch(/tag LIKE 'AUD-%' OR tag LIKE 'AUX-%'/);
  });

  it("does not replace the equipment_unit_state view", () => {
    expect(st.join("\n")).not.toMatch(/CREATE (OR REPLACE )?VIEW/i);
  });
});

describe("migration 287 (anon column grant)", () => {
  const st = statements(anonCols);
  const granted = (/GRANT SELECT \(([\s\S]*?)\) ON public\.equipment_products TO anon/.exec(anonCols)?.[1] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  it("only touches anon's SELECT on equipment_products", () => {
    expect(st).toEqual([
      "BEGIN",
      "REVOKE SELECT ON public.equipment_products FROM anon",
      expect.stringMatching(/^GRANT SELECT \([\s\S]+\) ON public\.equipment_products TO anon$/),
      "COMMIT",
    ]);
  });

  it("gives anon every column of 255's table and neither internal column", () => {
    const create = /CREATE TABLE public\.equipment_products \(([\s\S]*?)\n\);/.exec(read("supabase/migrations/255_equipment_hire.sql"))![1];
    const cols255 = [...create.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|integer|boolean|jsonb|timestamptz|text\[\])/gm)].map((m) => m[1]);
    expect(new Set(granted)).toEqual(new Set([...cols255, "is_kit"]));
    expect(granted).not.toContain("replacement_value_cents");
    expect(granted).not.toContain("sortly_sid");
  });
});

describe("migration numbers", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  const byNumber = new Map<string, string[]>();
  for (const f of files) {
    const n = f.split("_")[0];
    byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }

  it("uses 285, 286 and 287 once each", () => {
    expect(byNumber.get("285")).toEqual(["285_equipment_inventory_fields.sql"]);
    expect(byNumber.get("286")).toEqual(["286_equipment_seed_remaining_inventory.sql"]);
    expect(byNumber.get("287")).toEqual(["287_equipment_products_anon_columns.sql"]);
  });

  it("adds no new duplicate numbers (older duplicates predate this check)", () => {
    const recent = [...byNumber.entries()].filter(([n, fs]) => Number(n) >= 255 && fs.length > 1).map(([n]) => n);
    expect(recent).toEqual(["263"]);
  });
});
