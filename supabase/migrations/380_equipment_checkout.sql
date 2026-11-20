-- ============================================================
-- FFSA Hub — Migration 380: Equipment checkout (was 258 in PR 451; renumbered after main moved on)
-- ============================================================
-- Stage M of handoff/equipment-hire/PROMPT.md (spec rules 2, 4, 9, 10, 11).
-- Requires migrations 255 and 257.
--
-- 1. Orders that are waiting on PayFast. 255 had no such status, and a
--    quote holds nothing, so two people could pay for the last unit at the
--    same time. 'awaiting_payment' holds stock, but only until
--    hold_expires_at (set 30 minutes out at checkout). A paid ITN moves it
--    to 'confirmed'; a cancelled payment to 'cancelled'.
-- 2. Columns checkout collects: the ID number the staff member checks at
--    collection, and what the hire is for (a ministry's event name).
-- 3. equipment_place_order(): the whole checkout write in one transaction.
--    Locks every product on the order (FOR UPDATE, in id order so two
--    checkouts can't deadlock), re-checks equipment_free_count for each,
--    then inserts the order, its lines and its payments. Service role only:
--    the API route has already validated and priced everything.
-- ============================================================

-- ── 1. Awaiting payment ────────────────────────────────────
ALTER TABLE public.equipment_orders DROP CONSTRAINT IF EXISTS equipment_orders_status_check;
ALTER TABLE public.equipment_orders ADD CONSTRAINT equipment_orders_status_check
  CHECK (status IN ('quote', 'awaiting_payment', 'requested', 'confirmed', 'prepping', 'out',
                    'returned', 'inspected', 'closed', 'declined', 'cancelled'));

ALTER TABLE public.equipment_orders ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

-- ── 2. Collected at checkout ───────────────────────────────
ALTER TABLE public.equipment_orders ADD COLUMN IF NOT EXISTS customer_id_number text;
ALTER TABLE public.equipment_orders ADD COLUMN IF NOT EXISTS purpose text;

CREATE OR REPLACE FUNCTION public.equipment_holding_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['awaiting_payment', 'requested', 'confirmed', 'prepping', 'out', 'returned']::text[];
$$;

-- Same as 255, plus: an unpaid order stops holding once its hold expires.
CREATE OR REPLACE FUNCTION public.equipment_free_count(
  p_product uuid, p_from date, p_to date, p_ignore_order uuid DEFAULT NULL
) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH stock AS (
    SELECT count(*)::int AS n FROM equipment_units
    WHERE product_id = p_product AND status = 'available'
  ), days AS (
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
  SELECT greatest(0, (SELECT n FROM stock) - coalesce((SELECT max(q) FROM held), 0));
$$;

-- ── 3. Place an order ──────────────────────────────────────
-- p_order:    the equipment_orders columns to set (kind, status, customer_*,
--             ministry_id, purpose, dates, times, fulfilment, money, agreement…)
-- p_lines:    [{product_id, quantity, unit_price_cents, deposit_cents, line_total_cents}]
-- p_payments: [{kind, amount_cents, xero_item_code}]
-- Returns the new order's id, number and access_token, or raises
-- 'EQUIPMENT_NOT_FREE:<product_id>:<free>' when a line no longer fits.
CREATE OR REPLACE FUNCTION public.equipment_place_order(
  p_order jsonb, p_lines jsonb, p_payments jsonb
) RETURNS TABLE (id uuid, number text, access_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := (p_order->>'starts_on')::date;
  v_to   date := (p_order->>'ends_on')::date;
  v_need record;
  v_free integer;
  v_order public.equipment_orders;
BEGIN
  IF jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'EQUIPMENT_EMPTY_ORDER';
  END IF;

  -- Lock the products, then count. Anyone else placing an order for the same
  -- product waits here until this transaction commits.
  PERFORM 1 FROM equipment_products p
   WHERE p.id IN (SELECT (l->>'product_id')::uuid FROM jsonb_array_elements(p_lines) l)
   ORDER BY p.id
   FOR UPDATE;

  FOR v_need IN
    SELECT (l->>'product_id')::uuid AS product_id, sum((l->>'quantity')::int) AS qty
    FROM jsonb_array_elements(p_lines) l
    GROUP BY 1
  LOOP
    v_free := public.equipment_free_count(v_need.product_id, v_from, v_to);
    IF v_free < v_need.qty THEN
      RAISE EXCEPTION 'EQUIPMENT_NOT_FREE:%:%', v_need.product_id, v_free;
    END IF;
  END LOOP;

  INSERT INTO equipment_orders (
    kind, status, customer_user_id, customer_name, customer_email, customer_phone, customer_org,
    customer_id_number, ministry_id, purpose, starts_on, ends_on, collect_time, return_time,
    rate_period, fulfilment, delivery_address, subtotal_cents, waiver_cents, vat_cents,
    total_cents, deposit_cents, agreement_version, agreement_accepted_at, agreement_signed_name,
    hold_expires_at, notes, created_by
  ) VALUES (
    coalesce(p_order->>'kind', 'external'),
    p_order->>'status',
    nullif(p_order->>'customer_user_id', '')::uuid,
    p_order->>'customer_name',
    p_order->>'customer_email',
    nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'customer_org', ''),
    nullif(p_order->>'customer_id_number', ''),
    nullif(p_order->>'ministry_id', '')::uuid,
    nullif(p_order->>'purpose', ''),
    v_from, v_to,
    nullif(p_order->>'collect_time', '')::time,
    nullif(p_order->>'return_time', '')::time,
    coalesce(p_order->>'rate_period', 'day'),
    coalesce(p_order->>'fulfilment', 'collect'),
    nullif(p_order->>'delivery_address', ''),
    coalesce((p_order->>'subtotal_cents')::int, 0),
    coalesce((p_order->>'waiver_cents')::int, 0),
    coalesce((p_order->>'vat_cents')::int, 0),
    coalesce((p_order->>'total_cents')::int, 0),
    coalesce((p_order->>'deposit_cents')::int, 0),
    nullif(p_order->>'agreement_version', ''),
    nullif(p_order->>'agreement_accepted_at', '')::timestamptz,
    nullif(p_order->>'agreement_signed_name', ''),
    nullif(p_order->>'hold_expires_at', '')::timestamptz,
    nullif(p_order->>'notes', ''),
    nullif(p_order->>'created_by', '')::uuid
  ) RETURNING * INTO v_order;

  INSERT INTO equipment_order_lines (order_id, product_id, quantity, unit_price_cents, deposit_cents, line_total_cents)
  SELECT v_order.id, (l->>'product_id')::uuid, (l->>'quantity')::int,
         coalesce((l->>'unit_price_cents')::int, 0), coalesce((l->>'deposit_cents')::int, 0),
         coalesce((l->>'line_total_cents')::int, 0)
  FROM jsonb_array_elements(p_lines) l;

  INSERT INTO equipment_payments (order_id, kind, amount_cents, currency, status, payment_provider, xero_item_code, created_by)
  SELECT v_order.id, x->>'kind', (x->>'amount_cents')::int, 'ZAR', 'pending', 'payfast',
         nullif(x->>'xero_item_code', ''), nullif(p_order->>'created_by', '')::uuid
  FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) x
  WHERE (x->>'amount_cents')::int > 0;

  RETURN QUERY SELECT v_order.id, v_order.number, v_order.access_token;
END;
$$;

REVOKE ALL ON FUNCTION public.equipment_place_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_place_order(jsonb, jsonb, jsonb) TO service_role;
