-- ============================================================
-- FFSA Hub — Migration 270: stop dead orders holding ticket seats
-- ============================================================
-- ticket_types.quantity_sold is not a "sold" count. Checkout adds an
-- order's tickets to it the moment the buyer is sent to pay
-- (reserve_ticket_inventory, migration 058), before any money moves.
-- It only came back down on a full refund or a cancelled pay-later
-- invoice. It never came down when:
--   * the buyer abandoned the payment page (the order stays 'pending'
--     forever: the "expires_at + cron sweep" that 058 assumed was never
--     built), or
--   * PayFast / Stripe reported the payment cancelled or failed (the
--     webhooks cancel the order but leave its seats held).
-- So every abandoned checkout ate a seat for good. Event a8f11921 shows
-- it: Early Bird read "14/15 sold" against 8 tickets on paid orders.
-- One more buyer and the tier would have shut with 7 seats empty.
--
-- From here quantity_sold means "seats committed": tickets on paid
-- orders plus live holds. It still drives capacity and sell-out. The
-- admin "sold" figure is no longer read from it; it is counted from
-- paid orders (src/lib/ticketing/tier-inventory.ts), with live holds
-- shown beside it.
--
-- An order holds seats while it is:
--   paid, partially_refunded   tickets issued (a partial refund keeps them)
--   invoiced                   pay-later, seats kept until paid / cancelled
--   pending, not yet expired   inside its 30-minute payment window
--                              (expires_at NULL = a comped order mid-settle)
-- Anything else (expired, cancelled, refunded, a pending order past
-- expires_at) holds nothing.
--
-- What this adds:
--   1. orders.inventory_released_at — set once an order's seats have
--      been given back, so a release can never run twice.
--   2. release_ticket_holds(event, order) — gives back the seats of
--      every order that no longer holds them but hasn't been released.
--      Idempotent. Never touches an order that still holds seats, so
--      it is safe to call from anywhere.
--   3. reclaim_order_inventory(order) — a payment that lands after the
--      window closed (late webhook) takes its seats back.
--   4. reserve_ticket_inventory now sweeps the event's dead orders
--      before it checks capacity, so a stale hold can't refuse a buyer.
--   5. A one-off recount of every tier from the orders table.
--
-- Order status is NOT changed — a stale pending order stays 'pending'
-- so the Stripe reconcile paths can still settle it if the buyer did pay.
--
-- Safe to re-run: the column is IF NOT EXISTS, functions are CREATE OR
-- REPLACE, the backfill only touches rows still NULL, and the recount is
-- a pure function of the orders table. Re-run it when checkout is quiet:
-- a checkout that has reserved but not yet written its order (well under
-- a second) is not in the orders table yet and would be dropped.
--
-- Apply by hand in the Supabase SQL Editor.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. orders.inventory_released_at
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_released_at timestamptz;

COMMENT ON COLUMN public.orders.inventory_released_at IS
  'When this order''s seats were given back to its ticket tiers (expired, cancelled or refunded). NULL = the seats are still counted in ticket_types.quantity_sold. See migration 270.';

-- The sweep looks for unreleased orders per event.
CREATE INDEX IF NOT EXISTS idx_orders_unreleased_inventory
  ON public.orders (event_id)
  WHERE inventory_released_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- 2. order_holds_inventory — the one definition of "holds seats"
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.order_holds_inventory(
  p_status     text,
  p_expires_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_status IN ('paid', 'partially_refunded', 'invoiced')
      OR (p_status = 'pending' AND (p_expires_at IS NULL OR p_expires_at > now()));
$$;

COMMENT ON FUNCTION public.order_holds_inventory(text, timestamptz) IS
  'True while an order''s tickets count against tier capacity: paid / partially refunded / invoiced, or pending inside its payment window. Mirrors orderHoldsInventory() in src/lib/ticketing/tier-inventory.ts.';


-- ────────────────────────────────────────────────────────────
-- 3. release_ticket_holds
-- ------------------------------------------------------------
-- Marks every matching order that no longer holds seats as released
-- and takes its lines off quantity_sold, in one statement so the flag
-- and the counter can't drift apart. The row locks on orders make it
-- exactly-once under concurrency: a second caller re-checks
-- inventory_released_at after the first commits and skips the row.
--
-- p_event_id NULL = every event. p_order_id narrows it to one order.
-- Returns the number of orders released.
--
-- SECURITY DEFINER because finance staff refund orders under their own
-- session but can't write ticket_types under RLS (the old
-- release_ticket_inventory call silently changed nothing for them).
-- It only ever releases an order that has stopped holding seats, so a
-- caller can't use it to free seats that are really taken.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_ticket_holds(
  p_event_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released_count integer;
BEGIN
  -- Cheap exit on the hot path (every checkout calls this).
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE  o.inventory_released_at IS NULL
      AND  (p_event_id IS NULL OR o.event_id = p_event_id)
      AND  (p_order_id IS NULL OR o.id = p_order_id)
      AND  NOT public.order_holds_inventory(o.status, o.expires_at)
  ) THEN
    RETURN 0;
  END IF;

  -- One sweep at a time, so two sweeps never lock the same orders in
  -- different orders and deadlock. Sweeps are tiny; this costs nothing.
  PERFORM pg_advisory_xact_lock(hashtext('public.release_ticket_holds'));

  WITH released AS (
    UPDATE public.orders o
    SET    inventory_released_at = now()
    WHERE  o.inventory_released_at IS NULL
      AND  (p_event_id IS NULL OR o.event_id = p_event_id)
      AND  (p_order_id IS NULL OR o.id = p_order_id)
      AND  NOT public.order_holds_inventory(o.status, o.expires_at)
    RETURNING o.lines
  ),
  per_type AS (
    SELECT (l ->> 'ticket_type_id')::uuid           AS ticket_type_id,
           SUM(COALESCE((l ->> 'qty')::integer, 0)) AS qty
    FROM   released r,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.lines) = 'array' THEN r.lines ELSE '[]'::jsonb END
           ) l
    WHERE  l ->> 'ticket_type_id' IS NOT NULL
    GROUP  BY 1
  ),
  -- A data-modifying CTE always runs to completion, read or not.
  dec AS (
    UPDATE public.ticket_types t
    SET    quantity_sold = GREATEST(0, t.quantity_sold - p.qty)
    FROM   per_type p
    WHERE  t.id = p.ticket_type_id
      AND  p.qty > 0
  )
  SELECT count(*) INTO released_count FROM released;

  RETURN released_count;
END;
$$;

COMMENT ON FUNCTION public.release_ticket_holds(uuid, uuid) IS
  'Give back the seats of orders that no longer hold them (expired / cancelled / refunded / pending past expires_at). Idempotent via orders.inventory_released_at. NULL event = all events. Returns orders released.';


-- ────────────────────────────────────────────────────────────
-- 4. reclaim_order_inventory
-- ------------------------------------------------------------
-- A payment can land after the order's window closed and its seats
-- were released (a delayed webhook, or a Stripe reconcile days later).
-- The buyer has paid, so the order is honoured; this puts its seats
-- back on the counter. Clamped to capacity so the table's CHECK can't
-- reject it. Returns false if the tier had already been resold to
-- capacity (the order is then oversold; the app logs it).
-- Only acts on an order that holds seats but was released.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reclaim_order_inventory(
  p_order_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_lines jsonb;
  fits        boolean := true;
  l           record;
  tier        record;
BEGIN
  UPDATE public.orders o
  SET    inventory_released_at = NULL
  WHERE  o.id = p_order_id
    AND  o.inventory_released_at IS NOT NULL
    AND  public.order_holds_inventory(o.status, o.expires_at)
  RETURNING o.lines INTO order_lines;

  IF NOT FOUND THEN
    RETURN true;  -- nothing was released; nothing to reclaim
  END IF;

  FOR l IN
    SELECT (x ->> 'ticket_type_id')::uuid           AS ticket_type_id,
           SUM(COALESCE((x ->> 'qty')::integer, 0)) AS qty
    FROM   jsonb_array_elements(
             CASE WHEN jsonb_typeof(order_lines) = 'array' THEN order_lines ELSE '[]'::jsonb END
           ) x
    WHERE  x ->> 'ticket_type_id' IS NOT NULL
    GROUP  BY 1
    ORDER  BY 1
  LOOP
    IF l.qty <= 0 THEN CONTINUE; END IF;

    SELECT t.capacity, t.quantity_sold INTO tier
    FROM   public.ticket_types t
    WHERE  t.id = l.ticket_type_id
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;  -- tier deleted; nothing to put back

    IF tier.capacity IS NOT NULL AND tier.quantity_sold + l.qty > tier.capacity THEN
      fits := false;
    END IF;

    UPDATE public.ticket_types t
    SET    quantity_sold = CASE
             WHEN t.capacity IS NULL THEN t.quantity_sold + l.qty
             ELSE LEAST(t.capacity, t.quantity_sold + l.qty)
           END
    WHERE  t.id = l.ticket_type_id;
  END LOOP;

  RETURN fits;
END;
$$;

COMMENT ON FUNCTION public.reclaim_order_inventory(uuid) IS
  'Put a late-paid order''s released seats back on its tiers (clamped to capacity). Returns false if a tier was already full. See migration 270.';


-- ────────────────────────────────────────────────────────────
-- 5. reserve_ticket_inventory — sweep first
-- ------------------------------------------------------------
-- Same contract as migration 058; it now gives back the event's dead
-- holds before checking capacity, so an abandoned checkout can never
-- be the reason a buyer is turned away.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_ticket_inventory(
  p_ticket_type_id uuid,
  p_qty            integer
) RETURNS public.ticket_types
LANGUAGE plpgsql
AS $$
DECLARE
  updated    public.ticket_types;
  v_event_id uuid;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'reserve_ticket_inventory: qty must be > 0, got %', p_qty;
  END IF;

  SELECT event_id INTO v_event_id
  FROM   public.ticket_types
  WHERE  id = p_ticket_type_id;
  IF v_event_id IS NOT NULL THEN
    PERFORM public.release_ticket_holds(v_event_id, NULL);
  END IF;

  UPDATE public.ticket_types
  SET    quantity_sold = quantity_sold + p_qty
  WHERE  id = p_ticket_type_id
    AND  is_active = true
    AND  (capacity IS NULL OR quantity_sold + p_qty <= capacity)
    AND  (sales_start_at IS NULL OR sales_start_at <= now())
    AND  (sales_end_at   IS NULL OR sales_end_at   >  now())
  RETURNING * INTO updated;

  RETURN updated;
END;
$$;

COMMENT ON FUNCTION public.reserve_ticket_inventory(uuid, integer) IS
  'Atomic inventory hold for checkout. Releases the event''s dead holds first (migration 270). Returns the updated row, or NULL if guards fail (sold out / outside window / inactive).';


-- ────────────────────────────────────────────────────────────
-- 6. Grants
-- ────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.order_holds_inventory(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_ticket_holds(uuid, uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_order_inventory(uuid)            TO service_role;
REVOKE EXECUTE ON FUNCTION public.reclaim_order_inventory(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ticket_holds(uuid, uuid) FROM public, anon;


-- ────────────────────────────────────────────────────────────
-- 7. One-off recount
-- ------------------------------------------------------------
-- History can't be replayed: some dead orders were already given back
-- (full refunds, cancelled invoices, the promo-race cancel) and some
-- weren't (abandoned and provider-cancelled checkouts), and nothing
-- recorded which. So mark every order that holds nothing as released,
-- then rebuild each tier's counter from the orders that do.
-- ────────────────────────────────────────────────────────────

UPDATE public.orders o
SET    inventory_released_at = now()
WHERE  o.inventory_released_at IS NULL
  AND  NOT public.order_holds_inventory(o.status, o.expires_at);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    WITH held AS (
      SELECT (l ->> 'ticket_type_id')::uuid           AS ticket_type_id,
             SUM(COALESCE((l ->> 'qty')::integer, 0)) AS qty
      FROM   public.orders o,
             jsonb_array_elements(
               CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END
             ) l
      WHERE  o.inventory_released_at IS NULL
        AND  public.order_holds_inventory(o.status, o.expires_at)
        AND  l ->> 'ticket_type_id' IS NOT NULL
      GROUP  BY 1
    )
    SELECT id, name, capacity, old_qty, held_qty,
           -- Clamped so the capacity CHECK can't abort the migration.
           CASE WHEN capacity IS NULL THEN held_qty
                ELSE LEAST(held_qty, capacity) END AS new_qty
    FROM (
      SELECT t.id, t.name, t.capacity, t.quantity_sold AS old_qty,
             COALESCE(h.qty, 0)::integer AS held_qty
      FROM   public.ticket_types t
      LEFT   JOIN held h ON h.ticket_type_id = t.id
    ) s
  LOOP
    CONTINUE WHEN r.old_qty = r.new_qty;
    IF r.held_qty > r.new_qty THEN
      RAISE NOTICE 'ticket_type % (%) holds % against capacity % (oversold); counter set to capacity',
        r.id, r.name, r.held_qty, r.capacity;
    END IF;
    RAISE NOTICE 'ticket_type % (%): quantity_sold % -> %',
      r.id, r.name, r.old_qty, r.new_qty;
    UPDATE public.ticket_types SET quantity_sold = r.new_qty WHERE id = r.id;
  END LOOP;
END $$;


-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- Counter vs orders, per tier (expect no rows):
--   SELECT t.id, t.name, t.quantity_sold,
--          COALESCE(SUM((l->>'qty')::int), 0) AS held
--   FROM   public.ticket_types t
--   LEFT   JOIN public.orders o
--          ON o.event_id = t.event_id
--         AND o.inventory_released_at IS NULL
--         AND public.order_holds_inventory(o.status, o.expires_at)
--   LEFT   JOIN LATERAL jsonb_array_elements(o.lines) l
--          ON (l->>'ticket_type_id')::uuid = t.id
--   GROUP  BY t.id
--   HAVING t.quantity_sold <> COALESCE(SUM((l->>'qty')::int), 0);
--
--   -- The reported event (Early Bird should be 8 + live holds):
--   SELECT name, capacity, quantity_sold FROM public.ticket_types
--   WHERE  event_id = 'a8f11921-e4be-4b42-8f6b-41f68409fe3e';
-- ============================================================
