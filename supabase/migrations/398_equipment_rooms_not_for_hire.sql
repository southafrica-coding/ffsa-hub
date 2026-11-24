-- ============================================================
-- FFSA Hub — Migration 398: gear that's on show but not for hire
-- Requires migrations 255, 257 and 285. Run BEFORE 399.
--
-- FFSA wants every piece of gear on the hire store, but the gear kept in
-- the Auditorium, the Vault (studio) and the SBS classroom must never go
-- out. People should still see it, priced, just not be able to pick it.
--
-- Products are per model and shared across rooms (the Agera CA-12A has a
-- pair Upstairs and a pair in the SBS classroom), so the block is per
-- ROOM, not per product:
--
-- 1. equipment_locations.hire_allowed. Off for auditorium, studio and
--    sbs-classroom. A unit counts toward hire only when it is available
--    AND sits in a room that allows hire. A unit with no room (the
--    unverified Sortly imports) never counts.
-- 2. listed_needs_price no longer requires can_leave_building. A listed
--    product with can_leave_building = false, or with no hireable units,
--    is shown on the store as "Not for hire" and can't be picked.
-- 3. equipment_free_count counts hireable units only, so the cart, the
--    pick list and every other caller refuse blocked gear in the database,
--    not just on screen. can_leave_building = false means 0 free.
-- 4. equipment_listed_availability also returns on_site: available units
--    that exist but can't be hired, so the store can tell "Not for hire"
--    apart from "Booked". Its return type changes, so it is dropped and
--    recreated (same SECURITY DEFINER, same default EXECUTE).
--
-- No unit, order or price changes here; 399 sets the prices.
-- Safe to run twice.
-- To undo: re-run 255's equipment_free_count, 257's
-- equipment_listed_availability, restore the old CHECK, and drop the column.
-- ============================================================

BEGIN;

-- ── 1. Rooms that allow hire ───────────────────────────────
ALTER TABLE public.equipment_locations
  ADD COLUMN IF NOT EXISTS hire_allowed boolean NOT NULL DEFAULT true;

UPDATE public.equipment_locations
SET hire_allowed = false
WHERE slug IN ('auditorium', 'studio', 'sbs-classroom');

-- ── 2. Listing needs a price, not permission to leave ──────
ALTER TABLE public.equipment_products DROP CONSTRAINT IF EXISTS listed_needs_price;
ALTER TABLE public.equipment_products
  ADD CONSTRAINT listed_needs_price CHECK (NOT is_listed OR price_day_cents IS NOT NULL);

-- ── 3. Free = hireable units minus what orders hold ────────
CREATE OR REPLACE FUNCTION public.equipment_hireable_stock(p_product uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT p.can_leave_building THEN 0 ELSE (
    SELECT count(*)::int
    FROM equipment_units u
    JOIN equipment_locations l ON l.id = u.location_id
    WHERE u.product_id = p.id AND u.status = 'available' AND l.hire_allowed
  ) END
  FROM equipment_products p
  WHERE p.id = p_product;
$$;

CREATE OR REPLACE FUNCTION public.equipment_free_count(
  p_product uuid, p_from date, p_to date, p_ignore_order uuid DEFAULT NULL
) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ), held AS (
    SELECT days.day,
      (SELECT coalesce(sum(l.quantity), 0)::int
         FROM equipment_order_lines l
         JOIN equipment_orders o ON o.id = l.order_id
        WHERE l.product_id = p_product
          AND o.status = ANY (equipment_holding_statuses())
          AND days.day BETWEEN o.starts_on AND o.ends_on
          AND (p_ignore_order IS NULL OR o.id <> p_ignore_order)) AS q
    FROM days
  )
  SELECT greatest(0, coalesce(public.equipment_hireable_stock(p_product), 0)
                     - coalesce((SELECT max(q) FROM held), 0));
$$;

-- ── 4. Store availability, with "on show" units ────────────
DROP FUNCTION IF EXISTS public.equipment_listed_availability(date, date);

CREATE FUNCTION public.equipment_listed_availability(p_from date, p_to date)
RETURNS TABLE (product_id uuid, stock integer, free integer, on_site integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
    coalesce(public.equipment_hireable_stock(p.id), 0),
    public.equipment_free_count(p.id, p_from, p_to),
    (SELECT count(*)::int FROM equipment_units u
      LEFT JOIN equipment_locations l ON l.id = u.location_id
      WHERE u.product_id = p.id AND u.status = 'available'
        AND (NOT p.can_leave_building OR l.id IS NULL OR NOT l.hire_allowed))
  FROM equipment_products p
  WHERE p.is_listed AND NOT p.is_kit;
$$;

COMMIT;

-- Checks:
-- SELECT slug, hire_allowed FROM public.equipment_locations ORDER BY sort_order;
--   auditorium, studio, sbs-classroom = false; upstairs-classroom, old-prayer-room = true
-- SELECT public.equipment_hireable_stock(product_id), count(*) FROM public.equipment_units
--  WHERE tag IN ('UCL0005', 'SBS-0001') GROUP BY product_id;   -- the CA-12A: 2 hireable of 4
