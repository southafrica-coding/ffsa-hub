-- ============================================================
-- FFSA Hub — Migration 285: equipment inventory fields
-- Gives the rest of the sound-inventory sheet a home in the hire register.
-- Data: data/hire-inventory/hire-inventory.json (mapping in the PR).
-- Requires migrations 255 and 256. Seed data follows in 286.
--
-- Additive only. Every statement is safe to run twice:
--   ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING, and the backfill
--   only touches rows where owner_label is still NULL.
--
--   equipment_units.owner_label             the sheet's "Assigned to", verbatim
--                                           ("DTS/DBS/LTS Schools", "SBS School").
--                                           owner_ministry_id stays the structured link.
--   equipment_products.replacement_value_cents
--                                           per-unit value from the first (Sortly)
--                                           inventory, ZAR cents. INTERNAL guide for
--                                           lost/damaged gear. Not a hire price and
--                                           not used in any pricing or deduction maths.
--   equipment_products.sortly_sid           the Sortly item id (SDJDKT00xx). Internal.
--   equipment_units.source                  provenance for imports. Already created by
--                                           255; listed here so the column set is
--                                           explicit. IF NOT EXISTS makes it a no-op.
--
-- Access: the new columns sit on tables that already have RLS (255), so the
-- same policies cover them. Staff with equipment.operate can read and write
-- units; equipment.manage can write products. anon has no read policy on
-- equipment_units at all. Listed products are readable by anon, so the two
-- new product columns are taken out of anon's column grant in 287, which is
-- applied after this PR's code is deployed (see the PR).
--
-- equipment_unit_state (255) is `SELECT u.*`, frozen at creation, so it does
-- not show owner_label. It is deliberately NOT replaced here: the admin pages
-- read owner_label from equipment_units directly.
-- ============================================================

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────
ALTER TABLE public.equipment_units
  ADD COLUMN IF NOT EXISTS owner_label text;

ALTER TABLE public.equipment_units
  ADD COLUMN IF NOT EXISTS source jsonb;

ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS replacement_value_cents integer
    CONSTRAINT equipment_products_replacement_value_nonneg
    CHECK (replacement_value_cents IS NULL OR replacement_value_cents >= 0);

ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS sortly_sid text;

COMMENT ON COLUMN public.equipment_units.owner_label IS
  'Free-text "Assigned to" from the inventory sheet, kept verbatim. owner_ministry_id is the structured link.';
COMMENT ON COLUMN public.equipment_units.source IS
  'Import provenance: {"sheet","tab","row","sheet_quantity_header"} or {"origin":"sortly","unverified":true,"sortly_row"}. Internal.';
COMMENT ON COLUMN public.equipment_products.replacement_value_cents IS
  'Per-unit value from the first (Sortly) inventory, ZAR cents excl. VAT. Internal guide for lost/damaged gear, not a hire price. Never shown publicly.';
COMMENT ON COLUMN public.equipment_products.sortly_sid IS
  'Sortly item id (SDJDKT00xx) for traceability. Internal.';

-- ── 2. Locations for the other four sheet tabs ─────────────
INSERT INTO public.equipment_locations (name, slug, sort_order) VALUES
  ('Studio',             'studio',             10),
  ('Upstairs Classroom', 'upstairs-classroom', 20),
  ('SBS Classroom',      'sbs-classroom',      30),
  ('Old Prayer Room',    'old-prayer-room',    40)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Backfill the 95 live Auditorium-tab units (256) ─────
UPDATE public.equipment_units
SET owner_label = 'Prayer & Worship Ministry'
WHERE owner_label IS NULL
  AND (tag LIKE 'AUD-%' OR tag LIKE 'AUX-%');

COMMIT;

-- Check:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name IN ('equipment_units', 'equipment_products')
--    AND column_name IN ('owner_label', 'source', 'replacement_value_cents', 'sortly_sid');
-- SELECT owner_label, count(*) FROM public.equipment_units GROUP BY 1;   -- expect 95 'Prayer & Worship Ministry'
-- SELECT slug, name FROM public.equipment_locations ORDER BY sort_order;  -- auditorium + 4 new
