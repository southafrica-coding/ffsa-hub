-- ============================================================
-- FFSA Hub — Migration 257: Equipment storefront helpers
-- ============================================================
-- Stage L of handoff/equipment-hire/PROMPT.md. Requires migration 255.
--
-- 1. Starter store categories, so the listing editor has somewhere to put
--    a product. Named after the gear we actually own (frames 46a / 47a-1);
--    rename or add more any time — products only point at them by id.
-- 2. equipment_listed_availability(from, to): free count and stock for
--    every LISTED product in one call, so a category page doesn't make a
--    round trip per product. Same counting as equipment_free_count.
-- 3. equipment_free_from(product, from, qty): the first day on or after
--    `from` with at least `qty` free — the "Free from Tue 10 Nov" line.
-- Both are SECURITY DEFINER like 255's availability functions and only
-- answer for listed products, so anon learns nothing the store doesn't show.
-- ============================================================

-- ── 1. Store categories ────────────────────────────────────
INSERT INTO public.equipment_categories (name, slug, sort_order) VALUES
  ('Sound',             'sound',             10),
  ('Screens & cameras', 'screens-cameras',   20),
  ('Instruments',       'instruments',       30)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.equipment_categories (name, slug, parent_id, sort_order)
SELECT v.name, v.slug, (SELECT id FROM public.equipment_categories WHERE slug = 'sound'), v.sort_order
FROM (VALUES
  ('Speakers',        'speakers',        10),
  ('Microphones',     'microphones',     20),
  ('Mixers',          'mixers',          30),
  ('In-ear monitors', 'in-ear-monitors', 40)
) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Availability for every listed product ───────────────
CREATE OR REPLACE FUNCTION public.equipment_listed_availability(p_from date, p_to date)
RETURNS TABLE (product_id uuid, stock integer, free integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
    (SELECT count(*)::int FROM equipment_units u
      WHERE u.product_id = p.id AND u.status = 'available'),
    public.equipment_free_count(p.id, p_from, p_to)
  FROM equipment_products p
  WHERE p.is_listed AND NOT p.is_kit;
$$;

-- ── 3. When is it free again? ──────────────────────────────
-- NULL when nothing frees up inside the horizon (default ~6 months).
CREATE OR REPLACE FUNCTION public.equipment_free_from(
  p_product uuid, p_from date, p_qty integer DEFAULT 1, p_horizon integer DEFAULT 180
) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date
  FROM generate_series(p_from, p_from + p_horizon, interval '1 day') d
  WHERE EXISTS (SELECT 1 FROM equipment_products p WHERE p.id = p_product AND p.is_listed)
    AND public.equipment_free_count(p_product, d::date, d::date) >= greatest(p_qty, 1)
  ORDER BY d
  LIMIT 1;
$$;
