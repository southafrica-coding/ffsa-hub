-- ============================================================
-- FFSA Hub — Migration 381: Inventory (counted and consumable items)
-- ============================================================
-- Stage O, on top of equipment hire K/L/M (255–287, 380).
-- Requires 380 (equipment checkout).
--
-- Until now every product was made of tagged units (AUD-0014). The rest of
-- what FFSA owns — 60 glasses, 10 black tablecloths, 26 tealights — is
-- counted, not tagged. Each product now says how it is tracked:
--
--   tagged      as before: one equipment_units row per thing, each with a tag
--   counted     one product, a quantity ("we own 60"). Lent and returned.
--   consumable  a quantity on hand that only goes down when handed out.
--               Never lent, never on the store (consumables_not_booked).
--
-- equipment_products.stock_quantity is the count for counted and consumable
-- products. Nobody writes it directly: every change is a row in
-- equipment_stock_moves (bought, lost, damaged, handed out, …) and a trigger
-- applies it, so the count always has a history.
--
-- Borrowing: is_requestable puts a product on the internal borrow form
-- (/bookings/borrow) for any signed-in user, for a school or a ministry, at
-- the internal rate and with the rental manager's approval. is_listed stays
-- the public store. Orders can now be for a school (school_program_id).
--
-- Counted lines record what went out and what came back (qty_out, qty_back,
-- qty_damaged, qty_missing). Damaged and missing come off the stock.
--
-- Safe to run twice: IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS.
-- ============================================================

BEGIN;

-- ── 1. How a product is tracked ────────────────────────────
ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS tracking text NOT NULL DEFAULT 'tagged';
ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.equipment_locations (id);
ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS is_requestable boolean NOT NULL DEFAULT false;
ALTER TABLE public.equipment_products
  ADD COLUMN IF NOT EXISTS reorder_at integer;

ALTER TABLE public.equipment_products DROP CONSTRAINT IF EXISTS equipment_products_tracking_check;
ALTER TABLE public.equipment_products ADD CONSTRAINT equipment_products_tracking_check
  CHECK (tracking IN ('tagged', 'counted', 'consumable'));
ALTER TABLE public.equipment_products DROP CONSTRAINT IF EXISTS equipment_products_stock_nonneg;
ALTER TABLE public.equipment_products ADD CONSTRAINT equipment_products_stock_nonneg
  CHECK (stock_quantity >= 0);
ALTER TABLE public.equipment_products DROP CONSTRAINT IF EXISTS equipment_products_reorder_nonneg;
ALTER TABLE public.equipment_products ADD CONSTRAINT equipment_products_reorder_nonneg
  CHECK (reorder_at IS NULL OR reorder_at >= 0);
ALTER TABLE public.equipment_products DROP CONSTRAINT IF EXISTS consumables_not_booked;
ALTER TABLE public.equipment_products ADD CONSTRAINT consumables_not_booked
  CHECK (tracking <> 'consumable' OR (NOT is_listed AND NOT is_requestable AND NOT is_kit));

COMMENT ON COLUMN public.equipment_products.tracking IS
  'tagged = units with tags; counted = a quantity, lent and returned; consumable = a quantity that is used up.';
COMMENT ON COLUMN public.equipment_products.stock_quantity IS
  'Counted/consumable only: how many we own and can use. Written only by equipment_stock_moves (trigger).';
COMMENT ON COLUMN public.equipment_products.location_id IS
  'Counted/consumable only: where they are kept. Tagged units carry their own location.';
COMMENT ON COLUMN public.equipment_products.is_requestable IS
  'Any signed-in user may ask to borrow it for a school or ministry (/bookings/borrow).';
COMMENT ON COLUMN public.equipment_products.reorder_at IS
  'Consumables: flag the item when stock falls to this number.';

-- ── 2. Stock moves: the history behind stock_quantity ──────
CREATE TABLE IF NOT EXISTS public.equipment_stock_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.equipment_products (id) ON DELETE CASCADE,
  delta            integer NOT NULL CHECK (delta <> 0),
  reason           text NOT NULL CHECK (reason IN (
                     'opening',     -- first count (an import, or adding the item)
                     'bought',      -- more bought
                     'found',       -- turned up / repaired and back in use
                     'handed_out',  -- consumables given out
                     'lost',        -- missing, including missing on a return
                     'damaged',     -- broken beyond use, including on a return
                     'correction'   -- a recount; either sign
                   )),
  order_id         uuid REFERENCES public.equipment_orders (id) ON DELETE SET NULL,
  note             text,
  supplier         text,           -- 'bought' / 'opening'
  unit_cost_cents  integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  happened_on      date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Johannesburg')::date,
  actor_id         uuid REFERENCES public.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_move_sign CHECK (
    (reason IN ('opening', 'bought', 'found') AND delta > 0)
    OR (reason IN ('handed_out', 'lost', 'damaged') AND delta < 0)
    OR reason = 'correction'
  )
);
CREATE INDEX IF NOT EXISTS idx_equipment_stock_moves_product
  ON public.equipment_stock_moves (product_id, created_at DESC);

-- Applies a move to the product. SECURITY DEFINER because warehouse staff
-- (equipment.operate) record moves at check-in but can't write products.
CREATE OR REPLACE FUNCTION public.equipment_apply_stock_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tracking text;
  v_stock integer;
BEGIN
  SELECT tracking, stock_quantity INTO v_tracking, v_stock
    FROM equipment_products WHERE id = NEW.product_id FOR UPDATE;
  IF v_tracking IS NULL THEN
    RAISE EXCEPTION 'EQUIPMENT_UNKNOWN_PRODUCT';
  END IF;
  IF v_tracking = 'tagged' THEN
    RAISE EXCEPTION 'EQUIPMENT_TAGGED_HAS_NO_COUNT';
  END IF;
  -- Checked before the update so the error is ours, not the CHECK's.
  IF v_stock + NEW.delta < 0 THEN
    RAISE EXCEPTION 'EQUIPMENT_STOCK_NEGATIVE:%', v_stock;
  END IF;
  UPDATE equipment_products
     SET stock_quantity = stock_quantity + NEW.delta, updated_at = now()
   WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equipment_stock_move ON public.equipment_stock_moves;
CREATE TRIGGER trg_equipment_stock_move
  BEFORE INSERT ON public.equipment_stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.equipment_apply_stock_move();

-- ── 3. Orders: for a school, and counts on counted lines ───
ALTER TABLE public.equipment_orders
  ADD COLUMN IF NOT EXISTS school_program_id uuid REFERENCES public.programs (id);

ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS qty_out integer;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS qty_back integer;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS qty_damaged integer;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS qty_missing integer;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS counted_out_at timestamptz;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS counted_out_by uuid REFERENCES public.users (id);
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS counted_back_at timestamptz;
ALTER TABLE public.equipment_order_lines ADD COLUMN IF NOT EXISTS counted_back_by uuid REFERENCES public.users (id);

ALTER TABLE public.equipment_order_lines DROP CONSTRAINT IF EXISTS equipment_lines_counts_check;
ALTER TABLE public.equipment_order_lines ADD CONSTRAINT equipment_lines_counts_check CHECK (
  (qty_out IS NULL OR (qty_out >= 0 AND qty_out <= quantity))
  AND (qty_back IS NULL OR (
        qty_out IS NOT NULL AND qty_back >= 0
        AND coalesce(qty_damaged, 0) >= 0 AND coalesce(qty_missing, 0) >= 0
        AND qty_back + coalesce(qty_damaged, 0) + coalesce(qty_missing, 0) = qty_out))
);

-- ── 4. Availability counts counted stock ───────────────────
-- Same as 380, except the stock: tagged = available units (as before),
-- counted = stock_quantity, consumable = 0 (never lent).
CREATE OR REPLACE FUNCTION public.equipment_stock_of(p_product uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p.tracking
           WHEN 'tagged' THEN (SELECT count(*)::int FROM equipment_units u
                                WHERE u.product_id = p.id AND u.status = 'available')
           WHEN 'counted' THEN p.stock_quantity
           ELSE 0
         END
  FROM equipment_products p WHERE p.id = p_product;
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
          AND NOT (o.status = 'awaiting_payment' AND o.hold_expires_at < now())
          AND days.day BETWEEN o.starts_on AND o.ends_on
          AND (p_ignore_order IS NULL OR o.id <> p_ignore_order)) AS q
    FROM days
  )
  SELECT greatest(0, coalesce(public.equipment_stock_of(p_product), 0) - coalesce((SELECT max(q) FROM held), 0));
$$;

-- The store's availability (257), now with counted stock. Signed-in users
-- also get the requestable products, for the borrow form.
CREATE OR REPLACE FUNCTION public.equipment_listed_availability(p_from date, p_to date)
RETURNS TABLE (product_id uuid, stock integer, free integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
    coalesce(public.equipment_stock_of(p.id), 0),
    public.equipment_free_count(p.id, p_from, p_to)
  FROM equipment_products p
  WHERE NOT p.is_kit
    AND (p.is_listed OR (p.is_requestable AND auth.uid() IS NOT NULL));
$$;

CREATE OR REPLACE FUNCTION public.equipment_free_from(
  p_product uuid, p_from date, p_qty integer DEFAULT 1, p_horizon integer DEFAULT 180
) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date
  FROM generate_series(p_from, p_from + p_horizon, interval '1 day') d
  WHERE EXISTS (SELECT 1 FROM equipment_products p WHERE p.id = p_product
                 AND (p.is_listed OR (p.is_requestable AND auth.uid() IS NOT NULL)))
    AND public.equipment_free_count(p_product, d::date, d::date) >= greatest(p_qty, 1)
  ORDER BY d
  LIMIT 1;
$$;

-- Register counts for counted and consumable products, for staff: what we
-- own and what is free on p_day. Invoker, so products RLS applies.
CREATE OR REPLACE FUNCTION public.equipment_counted_today(p_day date)
RETURNS TABLE (product_id uuid, stock integer, free integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.stock_quantity,
    CASE WHEN p.tracking = 'counted' THEN public.equipment_free_count(p.id, p_day, p_day) ELSE p.stock_quantity END
  FROM equipment_products p
  WHERE p.tracking <> 'tagged';
$$;

-- ── 5. Count out / count back on a counted line ────────────
-- p_stage 'out':  p_count = how many went out (≤ booked).
-- p_stage 'back': p_count = how many came back fine; p_damaged, p_missing
--                 must add up with it to what went out. Damaged and missing
--                 come off the stock as moves tied to the order.
-- When every line on the order is counted (no tagged lines) the order moves
-- to 'out' once all are counted out and to 'returned' once all are back.
-- Orders with tagged lines move with the warehouse scan flow (stage N).
CREATE OR REPLACE FUNCTION public.equipment_count_line(
  p_line uuid, p_stage text, p_count integer,
  p_damaged integer DEFAULT 0, p_missing integer DEFAULT 0, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line equipment_order_lines;
  v_order equipment_orders;
  v_tracking text;
  v_all_counted boolean;
BEGIN
  IF NOT coalesce(public.can_operate_equipment(), false) THEN
    RAISE EXCEPTION 'EQUIPMENT_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_line FROM equipment_order_lines WHERE id = p_line FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'EQUIPMENT_UNKNOWN_LINE'; END IF;
  SELECT * INTO v_order FROM equipment_orders WHERE id = v_line.order_id FOR UPDATE;
  SELECT tracking INTO v_tracking FROM equipment_products WHERE id = v_line.product_id;
  IF v_tracking <> 'counted' THEN RAISE EXCEPTION 'EQUIPMENT_NOT_COUNTED'; END IF;

  IF p_stage = 'out' THEN
    IF v_order.status NOT IN ('confirmed', 'prepping', 'out') THEN
      RAISE EXCEPTION 'EQUIPMENT_ORDER_NOT_READY:%', v_order.status;
    END IF;
    IF v_line.qty_back IS NOT NULL THEN RAISE EXCEPTION 'EQUIPMENT_ALREADY_BACK'; END IF;
    IF p_count IS NULL OR p_count < 0 OR p_count > v_line.quantity THEN
      RAISE EXCEPTION 'EQUIPMENT_BAD_COUNT';
    END IF;
    UPDATE equipment_order_lines
       SET qty_out = p_count, counted_out_at = now(), counted_out_by = auth.uid()
     WHERE id = p_line;
    INSERT INTO equipment_events (order_id, kind, detail, actor_id)
    VALUES (v_order.id, 'counted_out', p_count || ' of ' || v_line.quantity
            || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid());

  ELSIF p_stage = 'back' THEN
    IF v_line.qty_out IS NULL THEN RAISE EXCEPTION 'EQUIPMENT_NOT_OUT'; END IF;
    IF v_line.qty_back IS NOT NULL THEN RAISE EXCEPTION 'EQUIPMENT_ALREADY_BACK'; END IF;
    IF p_count IS NULL OR p_count < 0 OR coalesce(p_damaged, 0) < 0 OR coalesce(p_missing, 0) < 0
       OR p_count + coalesce(p_damaged, 0) + coalesce(p_missing, 0) <> v_line.qty_out THEN
      RAISE EXCEPTION 'EQUIPMENT_BAD_COUNT';
    END IF;
    IF (coalesce(p_damaged, 0) + coalesce(p_missing, 0)) > 0 AND nullif(trim(p_note), '') IS NULL THEN
      RAISE EXCEPTION 'EQUIPMENT_NOTE_NEEDED';
    END IF;
    UPDATE equipment_order_lines
       SET qty_back = p_count, qty_damaged = coalesce(p_damaged, 0), qty_missing = coalesce(p_missing, 0),
           counted_back_at = now(), counted_back_by = auth.uid()
     WHERE id = p_line;
    IF coalesce(p_damaged, 0) > 0 THEN
      INSERT INTO equipment_stock_moves (product_id, delta, reason, order_id, note, actor_id)
      VALUES (v_line.product_id, -p_damaged, 'damaged', v_order.id, p_note, auth.uid());
    END IF;
    IF coalesce(p_missing, 0) > 0 THEN
      INSERT INTO equipment_stock_moves (product_id, delta, reason, order_id, note, actor_id)
      VALUES (v_line.product_id, -p_missing, 'lost', v_order.id, p_note, auth.uid());
    END IF;
    INSERT INTO equipment_events (order_id, kind, detail, actor_id)
    VALUES (v_order.id, 'counted_back',
            p_count || ' back' ||
            CASE WHEN coalesce(p_damaged, 0) > 0 THEN ', ' || p_damaged || ' damaged' ELSE '' END ||
            CASE WHEN coalesce(p_missing, 0) > 0 THEN ', ' || p_missing || ' missing' ELSE '' END ||
            coalesce(' · ' || nullif(trim(p_note), ''), ''),
            auth.uid());
  ELSE
    RAISE EXCEPTION 'EQUIPMENT_BAD_STAGE';
  END IF;

  -- Move an all-counted order along.
  SELECT bool_and(p.tracking = 'counted') INTO v_all_counted
    FROM equipment_order_lines l JOIN equipment_products p ON p.id = l.product_id
   WHERE l.order_id = v_order.id;
  IF v_all_counted THEN
    IF p_stage = 'out' AND v_order.status IN ('confirmed', 'prepping')
       AND NOT EXISTS (SELECT 1 FROM equipment_order_lines WHERE order_id = v_order.id AND qty_out IS NULL) THEN
      UPDATE equipment_orders SET status = 'out', updated_at = now() WHERE id = v_order.id;
    ELSIF p_stage = 'back' AND v_order.status = 'out'
       AND NOT EXISTS (SELECT 1 FROM equipment_order_lines WHERE order_id = v_order.id AND qty_back IS NULL) THEN
      UPDATE equipment_orders SET status = 'returned', updated_at = now() WHERE id = v_order.id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.equipment_count_line(uuid, text, integer, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_count_line(uuid, text, integer, integer, integer, text) TO authenticated;

COMMIT;

-- Check:
-- SELECT tracking, count(*) FROM public.equipment_products GROUP BY 1;   -- every existing product 'tagged'
-- SELECT public.equipment_free_count(id, current_date, current_date), name FROM public.equipment_products LIMIT 5;  -- unchanged for tagged
