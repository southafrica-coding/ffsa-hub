#!/usr/bin/env node
// Upload the 15 Sortly photos (data/hire-inventory/photos) to the hire
// products they belong to. For Jack to run by hand AFTER migrations 285 and
// 286 are applied. Nothing in CI or the app runs this.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   node scripts/upload-hire-inventory-photos.mjs            # dry run: prints the plan
//
//   ... node scripts/upload-hire-inventory-photos.mjs --apply  # actually uploads
//
// What it does, per photo listed in hire-inventory.json (product_value_updates
// and sortly_only_products, field photo_files):
//   1. finds the product by seed_key (skips with a warning if 286 isn't applied);
//   2. uploads the JPEG to the public `equipment-photos` bucket at
//      <product id>/sortly-<file name>, the same <product id>/… convention the
//      listing editor's photo API uses (src/lib/equipment/photos.ts). upsert is
//      off and an object that already exists is left alone;
//   3. adds an equipment_product_photos row, unless that product already has a
//      row for that file_path. sort_order continues after the product's existing
//      photos, so a product with none gets its first Sortly photo as the cover
//      (the store shows the lowest sort_order first).
// Safe to run twice. It never deletes anything and never prints the key.
// Photos only show publicly once a product is listed (RLS, migration 255).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "equipment-photos";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data/hire-inventory/hire-inventory.json");
const PHOTOS = path.join(ROOT, "data/hire-inventory/photos");


/** [{ seedKey, files }] for every product with photos in the JSON. */
export function photoPlan(data) {
  const out = [];
  for (const [seedKey, v] of Object.entries(data.product_value_updates)) {
    if (v.photo_files?.length) out.push({ seedKey, files: v.photo_files });
  }
  for (const p of data.sortly_only_products) {
    if (p.photo_files?.length) out.push({ seedKey: p.seed_key, files: p.photo_files });
  }
  return out;
}

export const objectPath = (productId, file) => `${productId}/sortly-${file}`;

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment first.\n" +
        "The service role key is in Supabase → Project Settings → API. It is never printed."
    );
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  const plan = photoPlan(data);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`${apply ? "APPLY" : "DRY RUN (add --apply to write)"} · ${plan.reduce((n, p) => n + p.files.length, 0)} photos for ${plan.length} products`);

  let uploaded = 0;
  let rows = 0;
  let skipped = 0;
  for (const { seedKey, files } of plan) {
    const { data: product, error } = await supabase
      .from("equipment_products")
      .select("id,name")
      .eq("seed_key", seedKey)
      .maybeSingle();
    if (error) throw new Error(`${seedKey}: ${error.message}`);
    if (!product) {
      console.warn(`! ${seedKey}: no product with this seed_key. Apply migration 286 first. Skipped.`);
      skipped += files.length;
      continue;
    }

    const { data: existingRows, error: rowsError } = await supabase
      .from("equipment_product_photos")
      .select("file_path,sort_order")
      .eq("product_id", product.id);
    if (rowsError) throw new Error(`${seedKey}: ${rowsError.message}`);
    const havePaths = new Set((existingRows ?? []).map((r) => r.file_path));
    let nextSort = (existingRows ?? []).reduce((m, r) => Math.max(m, r.sort_order + 1), 0);

    const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(product.id, { limit: 1000 });
    if (listError) throw new Error(`${seedKey}: ${listError.message}`);
    const haveObjects = new Set((objects ?? []).map((o) => `${product.id}/${o.name}`));

    for (const file of files) {
      const local = path.join(PHOTOS, file);
      if (!existsSync(local)) {
        console.warn(`! ${file}: not in data/hire-inventory/photos. Skipped.`);
        skipped++;
        continue;
      }
      const target = objectPath(product.id, file);

      if (haveObjects.has(target)) {
        console.log(`= ${seedKey} · ${file}: already in storage`);
      } else {
        console.log(`+ ${seedKey} · ${file} → ${BUCKET}/${target}`);
        if (apply) {
          const { error: upError } = await supabase.storage
            .from(BUCKET)
            .upload(target, readFileSync(local), { contentType: "image/jpeg", upsert: false });
          if (upError) throw new Error(`${file}: ${upError.message}`);
        }
        uploaded++;
      }

      if (havePaths.has(target)) {
        console.log(`= ${seedKey} · ${file}: photo row exists`);
      } else {
        console.log(`+ ${seedKey} · row (sort_order ${nextSort}${nextSort === 0 ? ", cover" : ""})`);
        if (apply) {
          const { error: insError } = await supabase
            .from("equipment_product_photos")
            .insert({ product_id: product.id, file_path: target, alt: product.name, sort_order: nextSort });
          if (insError) throw new Error(`${file}: ${insError.message}`);
        }
        nextSort++;
        rows++;
      }
    }
  }
  console.log(
    `${apply ? "Done" : "Would do"}: ${uploaded} uploads, ${rows} photo rows, ${skipped} skipped.` +
      (apply ? "" : " Nothing was written.")
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
