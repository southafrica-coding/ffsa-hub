-- ============================================================
-- FFSA Hub — Migration 382: Inventory access
-- ============================================================
-- Requires 381.
--
-- Who does what (permissions from 255, unchanged keys):
--   equipment.manage   the inventory manager: adds items, edits them,
--                      prices, approves requests, any stock change
--   equipment.operate  warehouse helpers: count out / count back, record
--                      stock moves (bought, lost, damaged, handed out)
--   equipment.view     read the register and orders
--   any signed-in user may read a product marked is_requestable (and its
--                      photos) so the borrow form can show it. Requests are
--                      placed by the API route with the service role, the
--                      same way checkout does (380), so no insert policy is
--                      opened to them.
--
-- Column note: authenticated users can read every column of a requestable
-- product row (RLS chooses rows, not columns), which includes
-- replacement_value_cents. That's a guide value for lost items, not a
-- secret; anon still gets only the store columns (287).
-- ============================================================

BEGIN;

-- ── 1. Stock moves ─────────────────────────────────────────
ALTER TABLE public.equipment_stock_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eq_move_read ON public.equipment_stock_moves;
CREATE POLICY eq_move_read ON public.equipment_stock_moves
  FOR SELECT TO authenticated USING (public.has_equipment_access());

-- Warehouse can record moves; the opening count and corrections are the
-- manager's (they change what the register says we own without a reason
-- anyone can check).
DROP POLICY IF EXISTS eq_move_insert ON public.equipment_stock_moves;
CREATE POLICY eq_move_insert ON public.equipment_stock_moves
  FOR INSERT TO authenticated WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.can_manage_equipment()
      OR (public.can_operate_equipment() AND reason IN ('bought', 'found', 'handed_out', 'lost', 'damaged'))
    )
  );
-- No UPDATE or DELETE policy: the history is append-only. A mistake is
-- fixed with a 'correction' move.

-- ── 2. Requestable products are readable by signed-in users ─
DROP POLICY IF EXISTS eq_prod_public ON public.equipment_products;
CREATE POLICY eq_prod_public ON public.equipment_products FOR SELECT USING (
  is_listed
  OR public.has_equipment_access()
  OR (is_requestable AND auth.uid() IS NOT NULL)
);

DROP POLICY IF EXISTS eq_photo_public ON public.equipment_product_photos;
CREATE POLICY eq_photo_public ON public.equipment_product_photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.equipment_products p WHERE p.id = product_id
           AND (p.is_listed OR public.has_equipment_access() OR (p.is_requestable AND auth.uid() IS NOT NULL)))
);

-- Locations of requestable items (the borrow form says where to collect).
DROP POLICY IF EXISTS eq_loc_read ON public.equipment_locations;
CREATE POLICY eq_loc_read ON public.equipment_locations
  FOR SELECT TO authenticated USING (true);

-- ── 3. Clearer names in Users & Roles ──────────────────────
UPDATE public.permissions SET display_name = 'Inventory: see items and orders'
 WHERE key = 'equipment.view';
UPDATE public.permissions SET display_name = 'Inventory: book gear at the ministry rate (store cart)'
 WHERE key = 'equipment.request';
UPDATE public.permissions SET display_name = 'Inventory: count out, count back, record stock'
 WHERE key = 'equipment.operate';
UPDATE public.permissions SET display_name = 'Inventory manager: add items, prices, approvals'
 WHERE key = 'equipment.manage';

COMMIT;

-- Check:
-- SELECT key, display_name FROM public.permissions WHERE module = 'equipment' ORDER BY sort_order;
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.equipment_stock_moves'::regclass;
