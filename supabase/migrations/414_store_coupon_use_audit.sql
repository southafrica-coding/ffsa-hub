-- ============================================================
-- FFSA Hub — Migration 414: Audit coupon use take and give-back
-- ============================================================
-- Follow-up to 413. Taking a use (store_apply_coupon) or giving one back
-- (cancel / delete, via store_coupon_redemption_released) now writes a
-- store_coupon_audit row: action 'take' or 'give_back', with the coupon
-- row before and after, and actor = auth.uid() (NULL for the service
-- role). Staff edits still go through store_coupons_audit, which keeps
-- skipping used_count-only updates so those don't also show as 'update'.
--
-- NOT APPLIED. Vercel previews share the production database, so applying
-- this anywhere is Jack's call. Run it by hand in the SQL Editor, after 413.
--
-- ============================================================

BEGIN;

-- Widen the action check so 'take' and 'give_back' are legal. Drop the
-- 413 unnamed (or our named) check first so this can run twice.
ALTER TABLE public.store_coupon_audit DROP CONSTRAINT IF EXISTS store_coupon_audit_action_check;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.store_coupon_audit'::regclass AND contype = 'c'
  LOOP
    IF r.def ~ 'action' AND r.def ~ '''create''' AND r.def !~ '''take''' THEN
      EXECUTE format('ALTER TABLE public.store_coupon_audit DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.store_coupon_audit
  ADD CONSTRAINT store_coupon_audit_action_check
  CHECK (action IN ('create', 'update', 'activate', 'deactivate', 'take', 'give_back'));

-- Taking a use now leaves an audit row (coupon snapshot before / after).
CREATE OR REPLACE FUNCTION public.store_apply_coupon(
  p_order_id uuid, p_code text, p_expected_discount_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_code      text := upper(btrim(coalesce(p_code, '')));
  v_order     public.store_orders%ROWTYPE;
  v_coupon    public.store_coupons%ROWTYPE;
  v_after     public.store_coupons%ROWTYPE;
  v_eligible  bigint;
  v_lines     integer;
  v_discount  integer;
  v_rows      integer;
BEGIN
  IF length(v_code) NOT BETWEEN 3 AND 40 OR v_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
    RETURN jsonb_build_object('outcome', 'malformed');
  END IF;

  SELECT * INTO v_order FROM public.store_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending' OR v_order.coupon_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'order');
  END IF;

  -- The row lock: a second checkout for the same code waits here until the
  -- first commits, then sees its used_count.
  SELECT * INTO v_coupon FROM public.store_coupons WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'unknown');
  END IF;
  IF NOT v_coupon.active THEN
    RETURN jsonb_build_object('outcome', 'inactive');
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('outcome', 'used_up');
  END IF;

  SELECT coalesce(sum(i.unit_price_cents::bigint * i.quantity), 0), count(*)
    INTO v_eligible, v_lines
    FROM public.store_order_items i
   WHERE i.order_id = v_order.id
     AND (v_coupon.product_id IS NULL OR i.product_id = v_coupon.product_id);
  IF v_coupon.product_id IS NOT NULL AND v_lines = 0 THEN
    RETURN jsonb_build_object('outcome', 'wrong_product');
  END IF;
  v_eligible := least(v_eligible, v_order.subtotal_cents);

  IF v_coupon.percent_off IS NOT NULL THEN
    v_discount := (v_eligible * v_coupon.percent_off / 100)::integer;   -- integer division = floor
  ELSE
    v_discount := least(v_coupon.amount_off_cents::bigint, v_eligible)::integer;
  END IF;

  IF p_expected_discount_cents IS NOT NULL AND v_discount <> p_expected_discount_cents THEN
    RETURN jsonb_build_object('outcome', 'changed', 'discount_cents', v_discount);
  END IF;

  UPDATE public.store_coupons
     SET used_count = used_count + 1
   WHERE id = v_coupon.id
     AND (max_uses IS NULL OR used_count < max_uses);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RETURN jsonb_build_object('outcome', 'used_up');
  END IF;

  SELECT * INTO v_after FROM public.store_coupons WHERE id = v_coupon.id;
  INSERT INTO public.store_coupon_audit (coupon_id, action, actor, old_row, new_row)
  VALUES (v_coupon.id, 'take', auth.uid(), to_jsonb(v_coupon), to_jsonb(v_after));

  INSERT INTO public.store_coupon_redemptions (coupon_id, order_id, amount_cents)
  VALUES (v_coupon.id, v_order.id, v_discount);

  UPDATE public.store_orders
     SET coupon_id = v_coupon.id,
         discount_cents = v_discount,
         total_cents = subtotal_cents + delivery_cents - v_discount
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'coupon_id', v_coupon.id,
    'discount_cents', v_discount,
    'total_cents', v_order.subtotal_cents + v_order.delivery_cents - v_discount
  );
END;
$$;

-- Giving a use back (redemption deleted by cancel, or by ON DELETE CASCADE)
-- writes a matching give_back row, only when used_count actually moved.
CREATE OR REPLACE FUNCTION public.store_coupon_redemption_released()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old public.store_coupons%ROWTYPE;
  v_new public.store_coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.store_coupons WHERE id = OLD.coupon_id;
  UPDATE public.store_coupons
     SET used_count = used_count - 1
   WHERE id = OLD.coupon_id AND used_count > 0;
  IF FOUND THEN
    SELECT * INTO v_new FROM public.store_coupons WHERE id = OLD.coupon_id;
    INSERT INTO public.store_coupon_audit (coupon_id, action, actor, old_row, new_row)
    VALUES (OLD.coupon_id, 'give_back', auth.uid(), to_jsonb(v_old), to_jsonb(v_new));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.store_apply_coupon(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_apply_coupon(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.store_coupon_redemption_released() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.store_coupon_audit'::regclass AND contype = 'c';
--     -- expect store_coupon_audit_action_check including 'take' and 'give_back'
--   -- Apply a code to a pending test order, then cancel it (not in production):
--   --   expect one 'take' and one 'give_back' on that coupon, used_count back
--   --   to what it was. Do not apply this migration against production to try it.
-- ============================================================
