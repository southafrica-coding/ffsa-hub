-- ============================================================
-- FFSA Hub — Migration 287: keep internal product columns off the public store
-- Requires migration 285. Apply AFTER the code from the same PR is deployed.
--
-- 255 lets anyone (anon included) read a product row once it is listed
-- (policy eq_prod_public). RLS chooses rows, not columns, so on its own it
-- would hand anon the two internal columns 285 added:
--   replacement_value_cents   per-unit value for lost/damaged gear
--   sortly_sid                the Sortly item id
-- This swaps anon's table-wide SELECT for a column list: every column anon
-- could read before 285, and nothing else. No row, policy or data changes.
--
-- Why after the deploy: with a column grant, `select *` as anon fails with
-- "permission denied". This PR's storefront asks for named columns
-- (STORE_PRODUCT_COLUMNS in src/services/equipment.ts); the code before it
-- used `select *`. Deploy first, then run this.
--
-- Staff are `authenticated`, not anon, so the admin pages keep `select *`.
-- A column added to equipment_products later is NOT visible to anon until
-- it is added to a GRANT like the one below; the store only needs that if
-- it starts showing the new column.
--
-- Safe to run twice: REVOKE then the same GRANT gives the same result.
-- To undo (back to 255's behaviour): GRANT SELECT ON public.equipment_products TO anon;
-- ============================================================

BEGIN;

REVOKE SELECT ON public.equipment_products FROM anon;

GRANT SELECT (
  id, seed_key, name, brand, model, slug, register_category, store_category_id,
  owner_ministry_id, description, included, specs, can_leave_building, is_listed,
  listed_at, price_day_cents, price_weekend_cents, price_week_cents, deposit_cents,
  internal_day_cents, max_per_order, sort_order, created_by, created_at, updated_at,
  is_kit
) ON public.equipment_products TO anon;

COMMIT;

-- Check: replacement_value_cents and sortly_sid must not be in this list.
-- SELECT column_name FROM information_schema.column_privileges
--  WHERE table_schema = 'public' AND table_name = 'equipment_products'
--    AND grantee = 'anon' AND privilege_type = 'SELECT' ORDER BY 1;
