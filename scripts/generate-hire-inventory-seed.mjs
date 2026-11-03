#!/usr/bin/env node
// Generates supabase/migrations/286_equipment_seed_remaining_inventory.sql
// from data/hire-inventory/hire-inventory.json. Plain Node ESM, no deps.
//
//   node scripts/generate-hire-inventory-seed.mjs           write the migration
//   node scripts/generate-hire-inventory-seed.mjs --check   exit 1 if it is stale
//
// Output is deterministic (no dates, no randomness, JSON order), so a test
// regenerates it in memory and compares it with the committed file.
// It never touches a database: Jack applies the migration by hand.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const JSON_PATH = "data/hire-inventory/hire-inventory.json";
export const SEED_256_PATH = "supabase/migrations/256_equipment_seed_auditorium.sql";
export const OUT_PATH = "supabase/migrations/286_equipment_seed_remaining_inventory.sql";

export const SORTLY_NOTE =
  "Imported from the first Sortly inventory. Not yet physically verified - check the shelf and retire if it does not exist.";

// ── Helpers ────────────────────────────────────────────────

/** Same slug rule 256 used: lower-kebab of "brand model name", gaps named. */
export function slugify(brand, model, name) {
  return `${brand ?? "no brand"} ${model ?? "no model"} ${name}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** SQL literal. */
function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`Not an integer: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const row = (values) => `  (${values.map(q).join(", ")})`;

/** The 28 products 256 put live: seed_key → slug. */
export function liveProductsFrom256(sql) {
  const start = sql.indexOf("INSERT INTO public.equipment_products");
  const end = sql.indexOf("AS v(seed_key", start);
  if (start < 0 || end < 0) throw new Error("Could not find the products block in 256");
  const out = new Map();
  for (const line of sql.slice(start, end).split("\n")) {
    const m = /^\s*\('([^']+)',.*'([a-z0-9-]+)'\),?\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const isStand = (name) => /\bstands?\b/i.test(name);

// ── Build ──────────────────────────────────────────────────

/**
 * Everything the migration will insert, computed from the JSON. Throws on
 * anything that would make the SQL wrong (unknown product key, duplicate tag).
 */
export function planSeed(data, live) {
  const newProducts = Object.entries(data.new_products).map(([key, p]) => ({
    seed_key: key,
    name: p.name,
    brand: p.brand,
    model: p.model,
    register_category: p.register_category,
    owner: p.owner_ministry_slug,
    sortly_sid: null,
    replacement_value_cents: null,
  }));
  const sortlyProducts = data.sortly_only_products.map((p) => ({
    seed_key: p.seed_key,
    name: p.name,
    brand: null,
    model: null,
    register_category: isStand(p.name) ? "auxiliary" : "audio",
    owner: null,
    sortly_sid: p.sid,
    replacement_value_cents: p.replacement_value_cents,
  }));

  // Slugs: unique against the live 256 slugs and each other.
  const taken = new Set(live.values());
  for (const p of [...newProducts, ...sortlyProducts]) {
    if (live.has(p.seed_key)) throw new Error(`seed_key ${p.seed_key} is already live (256)`);
    const base = slugify(p.brand, p.model, p.name);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    p.slug = slug;
  }

  const known = new Set([...live.keys(), ...newProducts.map((p) => p.seed_key), ...sortlyProducts.map((p) => p.seed_key)]);
  const locationSlugs = new Set(["auditorium", ...data.locations.map((l) => l.slug)]);

  const sheetUnits = data.units.filter((u) => !u.already_seeded);
  const sortlyUnits = data.sortly_only_units;
  const tags = new Set(data.units.filter((u) => u.already_seeded).map((u) => u.tag));
  for (const u of [...sheetUnits, ...sortlyUnits]) {
    if (!known.has(u.product_key)) throw new Error(`${u.tag}: unknown product_key ${u.product_key}`);
    if (tags.has(u.tag)) throw new Error(`Duplicate tag ${u.tag}`);
    tags.add(u.tag);
  }
  for (const u of sheetUnits) {
    if (u.location && !locationSlugs.has(u.location)) throw new Error(`${u.tag}: unknown location ${u.location}`);
  }

  const valueUpdates = Object.entries(data.product_value_updates).map(([key, v]) => {
    if (!known.has(key)) throw new Error(`product_value_updates: unknown product ${key}`);
    return { seed_key: key, replacement_value_cents: v.replacement_value_cents, sortly_sid: v.sortly_sid };
  });

  return {
    newProducts,
    sortlyProducts,
    sheetUnits,
    sortlyUnits,
    valueUpdates,
    ownerSlug: data.owner_label_to_ministry_slug,
    liveUnits: data.units.filter((u) => u.already_seeded).length,
    liveProducts: live.size,
  };
}

export function buildSeedSql(data, seed256Sql) {
  const live = liveProductsFrom256(seed256Sql);
  const plan = planSeed(data, live);
  const allProducts = [...plan.newProducts, ...plan.sortlyProducts];
  const newTags = [...plan.sheetUnits, ...plan.sortlyUnits].map((u) => u.tag);
  const tagArray = `ARRAY[\n${chunk(newTags.map(q), 8).map((c) => `  ${c.join(", ")}`).join(",\n")}\n]`;
  const unitTotal = plan.sheetUnits.length + plan.sortlyUnits.length;
  const tabs = [...new Set(plan.sheetUnits.map((u) => u.tab))];

  const L = [];
  L.push(
    "-- ============================================================",
    "-- FFSA Hub — Migration 286: seed the rest of the sound inventory",
    "-- GENERATED by scripts/generate-hire-inventory-seed.mjs from",
    `-- ${JSON_PATH}. Do not edit by hand: change the JSON or the`,
    "-- script, run `node scripts/generate-hire-inventory-seed.mjs`, commit both.",
    "-- Requires migrations 255, 256, 257 and 285 (owner_label, sortly_sid,",
    "-- replacement_value_cents, the four new locations).",
    "--",
    `-- Tabs: ${tabs.join(" · ")}`,
    "-- plus the unmatched items of the first Sortly inventory (Value tab).",
    "--",
    "-- IMPORTING NEVER LISTS ANYTHING: every new product is is_listed = false,",
    "-- no price, can_leave_building = false, no store category.",
    "-- Existing rows are only touched to fill a NULL replacement_value_cents /",
    "-- sortly_sid on the products named in section 6.",
    "-- Safe to run twice: ON CONFLICT DO NOTHING, NOT EXISTS, IS NULL guards.",
    "--",
    "-- Expected end state:",
    `--   units:    +${plan.sheetUnits.length} sheet units, +${plan.sortlyUnits.length} unverified Sortly units = +${unitTotal}` +
      ` (${plan.liveUnits} -> ${plan.liveUnits + unitTotal})`,
    `--   products: +${plan.newProducts.length} for the sheet units, +${plan.sortlyProducts.length} Sortly-only = +${allProducts.length}` +
      ` (${plan.liveProducts} -> ${plan.liveProducts + allProducts.length})`,
    `--   values:   replacement_value_cents filled on ${plan.valueUpdates.length} products`,
    "--   listed:   unchanged (only the products already listed by hand)",
    "-- ============================================================",
    "",
    "BEGIN;",
    ""
  );

  // 1. Products for the sheet units
  L.push(
    "-- ── 1. Products for the new sheet units ────────────────────",
    "-- Owner by ministry slug; NULL when that ministry doesn't exist.",
    "-- A slug already used by a hand-made product gets the seed_key appended.",
    "INSERT INTO public.equipment_products",
    "  (seed_key, name, brand, model, register_category, owner_ministry_id, slug,",
    "   specs, included, is_listed, price_day_cents, can_leave_building)",
    "SELECT v.seed_key, v.name, v.brand, v.model, v.cat,",
    "       (SELECT id FROM public.ministries WHERE slug = v.owner),",
    "       CASE WHEN EXISTS (SELECT 1 FROM public.equipment_products e WHERE e.slug = v.slug)",
    "            THEN v.slug || '-' || v.seed_key ELSE v.slug END,",
    "       '{}'::jsonb, '{}'::text[], false, NULL, false",
    "FROM (VALUES",
    plan.newProducts
      .map((p) => row([p.seed_key, p.name, p.brand, p.model, p.register_category, p.owner, p.slug]))
      .join(",\n"),
    ") AS v(seed_key, name, brand, model, cat, owner, slug)",
    "ON CONFLICT DO NOTHING;",
    ""
  );

  // 2. Sortly-only products
  L.push(
    "-- ── 2. Products for the unmatched Sortly items ─────────────",
    "-- Name as written in Sortly; no brand, model or owner. Unlisted.",
    "INSERT INTO public.equipment_products",
    "  (seed_key, name, brand, model, register_category, owner_ministry_id, slug,",
    "   specs, included, is_listed, price_day_cents, can_leave_building,",
    "   sortly_sid, replacement_value_cents)",
    "SELECT v.seed_key, v.name, NULL, NULL, v.cat, NULL,",
    "       CASE WHEN EXISTS (SELECT 1 FROM public.equipment_products e WHERE e.slug = v.slug)",
    "            THEN v.slug || '-' || v.seed_key ELSE v.slug END,",
    "       '{}'::jsonb, '{}'::text[], false, NULL, false,",
    "       v.sid, v.value::integer",
    "FROM (VALUES",
    plan.sortlyProducts
      .map((p) => row([p.seed_key, p.name, p.register_category, p.slug, p.sortly_sid, p.replacement_value_cents]))
      .join(",\n"),
    ") AS v(seed_key, name, cat, slug, sid, value)",
    "ON CONFLICT DO NOTHING;",
    ""
  );

  // 3. Sheet units
  L.push(
    "-- ── 3. Units from the four sheet tabs ──────────────────────",
    "-- owner_label is the sheet's \"Assigned to\" verbatim; owner_ministry_id the",
    "-- ministry it maps to (NULL when that ministry doesn't exist).",
    "INSERT INTO public.equipment_units",
    "  (product_id, tag, label, serial, status, condition, condition_note,",
    "   location_id, owner_ministry_id, owner_label, supplier,",
    "   purchase_date, purchase_price_cents, warranty_until, last_checked_on, source)",
    "SELECT p.id, v.tag, v.label, v.serial, v.status, v.cond, v.note,",
    "       (SELECT id FROM public.equipment_locations WHERE slug = v.loc),",
    "       (SELECT id FROM public.ministries WHERE slug = v.owner),",
    "       v.owner_label, v.supplier,",
    "       v.bought::date, v.price::integer, v.warranty::date, v.checked::date,",
    "       jsonb_build_object('sheet', 'FFSA INVENTORY', 'tab', v.tab, 'row', v.row::integer,",
    "                          'sheet_quantity_header', v.qty::integer)",
    "FROM (VALUES",
    plan.sheetUnits
      .map((u) =>
        row([
          u.product_key,
          u.tag,
          u.label,
          u.serial,
          u.status,
          u.condition,
          u.condition_note,
          u.location,
          u.owner_label ? (plan.ownerSlug[u.owner_label] ?? null) : null,
          u.owner_label,
          u.supplier,
          u.purchase_date,
          u.purchase_price_cents,
          u.warranty_until,
          u.last_checked_on,
          u.tab,
          u.row,
          u.sheet_quantity_header,
        ])
      )
      .join(",\n"),
    ") AS v(seed_key, tag, label, serial, status, cond, note, loc, owner, owner_label, supplier,",
    "       bought, price, warranty, checked, tab, row, qty)",
    "JOIN public.equipment_products p ON p.seed_key = v.seed_key",
    "ON CONFLICT (tag) DO NOTHING;",
    ""
  );

  // 4. Sortly units
  L.push(
    "-- ── 4. Unverified units from the Sortly inventory ──────────",
    "-- No location, no owner: nobody has checked these exist. The register",
    "-- flags them \"Unverified\"; retire any that turn out to be duplicates.",
    "INSERT INTO public.equipment_units",
    "  (product_id, tag, label, serial, status, condition, condition_note,",
    "   location_id, owner_ministry_id, owner_label, source)",
    `SELECT p.id, v.tag, NULL, v.serial, 'available', NULL, ${q(SORTLY_NOTE)},`,
    "       NULL, NULL, NULL,",
    "       jsonb_build_object('origin', 'sortly', 'unverified', true, 'sortly_row', v.row::integer, 'sid', v.sid)",
    "FROM (VALUES",
    plan.sortlyUnits
      .map((u) => {
        const prod = plan.sortlyProducts.find((p) => p.seed_key === u.product_key);
        return row([u.product_key, u.tag, u.serial, u.sortly_row, prod?.sortly_sid ?? null]);
      })
      .join(",\n"),
    ") AS v(seed_key, tag, serial, row, sid)",
    "JOIN public.equipment_products p ON p.seed_key = v.seed_key",
    "ON CONFLICT (tag) DO NOTHING;",
    ""
  );

  // 5. Events + maintenance
  L.push(
    "-- ── 5. History: one 'imported' event per new unit ──────────",
    "INSERT INTO public.equipment_events (unit_id, kind, detail)",
    "SELECT u.id, 'imported',",
    "       CASE WHEN u.source->>'origin' = 'sortly'",
    "            THEN 'Imported from the first Sortly inventory (Value tab, row ' || (u.source->>'sortly_row') || '). Not yet physically verified.'",
    "            ELSE 'Imported from FFSA INVENTORY, tab ' || (u.source->>'tab') || ', row ' || (u.source->>'row') END",
    "FROM public.equipment_units u",
    `WHERE u.tag = ANY (${tagArray})`,
    "  AND NOT EXISTS (SELECT 1 FROM public.equipment_events e WHERE e.unit_id = u.id AND e.kind = 'imported');",
    "",
    "-- New units marked broken open a maintenance job, as 256 did.",
    "INSERT INTO public.equipment_maintenance (unit_id, status, reason)",
    "SELECT u.id, 'reported', coalesce(nullif(u.condition_note, ''), u.condition, 'Marked broken on the sheet')",
    "FROM public.equipment_units u",
    "WHERE u.status = 'maintenance'",
    `  AND u.tag = ANY (${tagArray})`,
    "  AND NOT EXISTS (SELECT 1 FROM public.equipment_maintenance m WHERE m.unit_id = u.id AND m.status <> 'done');",
    ""
  );

  // 6. Values
  L.push(
    "-- ── 6. Sortly values on matched products ───────────────────",
    "-- Only fills a NULL value; never touches price, listing or category.",
    "-- replacement_value_cents is an internal guide, not a hire price."
  );
  for (const v of plan.valueUpdates) {
    const sid = v.sortly_sid ? `, sortly_sid = coalesce(sortly_sid, ${q(v.sortly_sid)})` : "";
    L.push(
      `UPDATE public.equipment_products SET replacement_value_cents = ${q(v.replacement_value_cents)}${sid} ` +
        `WHERE seed_key = ${q(v.seed_key)} AND replacement_value_cents IS NULL;`
    );
  }
  L.push(
    "",
    "COMMIT;",
    "",
    "-- Check (scripts/hire-inventory-verify.sql has the full set):",
    `-- SELECT count(*) FROM public.equipment_units;                         -- ${plan.liveUnits + unitTotal} if nothing else was added`,
    "-- SELECT count(*) FROM public.equipment_products WHERE is_listed;       -- unchanged",
    ""
  );
  return L.join("\n");
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function generateFromRepo(root) {
  const data = JSON.parse(readFileSync(path.join(root, JSON_PATH), "utf8"));
  const seed256 = readFileSync(path.join(root, SEED_256_PATH), "utf8");
  return buildSeedSql(data, seed256);
}

// ── CLI ────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sql = generateFromRepo(root);
  const out = path.join(root, OUT_PATH);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {
      // missing counts as stale
    }
    if (current !== sql) {
      console.error(`${OUT_PATH} is stale. Run: node scripts/generate-hire-inventory-seed.mjs`);
      process.exit(1);
    }
    console.log(`${OUT_PATH} is up to date.`);
  } else {
    writeFileSync(out, sql);
    console.log(`Wrote ${OUT_PATH}`);
  }
}
