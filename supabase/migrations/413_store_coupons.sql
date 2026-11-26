-- ============================================================
-- FFSA Hub — Migration 413: Store coupon codes
-- ============================================================
-- Checkout discount codes for the Hub Store (412): "REVIEW2026" for 20%
-- off, "FRIEND-100" for R100 off one product, a 100% code that makes an
-- order free. Staff with store.manage create them in /store/admin/coupons.
--
-- NOT APPLIED. Vercel previews share the production database, so applying
-- this anywhere is Jack's call. Run it by hand in the SQL Editor, after 412.
--
-- Not the same thing as store_codes (412): those are gift / pack codes
-- (XXXX-XXXX-XXXX) that GRANT a product once a paid order settles, claimed
-- at /store/redeem. Coupons only change what an order costs at checkout.
-- Nothing here touches store_codes.
--
-- What this migration does NOT do, on purpose:
--   * no coupon, order or user rows. Codes (including any complimentary
--     codes) are made in the admin after this is applied.
--
-- Access model
--   * Buyers (anon / authenticated without a store grant) can't read any
--     coupon table. A code is checked on the server only: the checkout,
--     quote and validate routes use the service role, and the use is taken
--     by store_apply_coupon (service role only).
--   * Staff: store.view reads coupons; store.manage (or admin) creates and
--     edits them, and reads redemptions and the audit trail. No DELETE:
--     a code is turned off (active = false), so its history stays.
--   * used_count is never written by staff: only store_apply_coupon takes a
--     use, and the release triggers give one back.
--
-- Use counting
--   * store_apply_coupon locks the coupon row (FOR UPDATE), re-checks it,
--     takes one use with UPDATE ... WHERE used_count < max_uses, writes the
--     redemption and stamps the order's coupon_id / discount_cents / total
--     in one transaction. Two buyers racing for the last use: one wins.
--   * The use is taken when the PENDING order is made, so two people can't
--     both pay for the last use. It's given back when the order is
--     cancelled (any path: admin cancel, PayFast / Stripe cancel, a failed
--     checkout) or deleted: the redemption row is removed, and removing a
--     redemption gives the use back. A pending order nobody cancels keeps
--     its use until someone does.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Coupons
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_coupons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored upper case. Letters, numbers and single hyphens: REVIEW2026, FRIEND-100.
  code              text NOT NULL
                    CONSTRAINT store_coupons_code_shape_check
                    CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 40 AND code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  description       text CONSTRAINT store_coupons_description_check CHECK (description IS NULL OR length(description) <= 200),
  percent_off       integer CONSTRAINT store_coupons_percent_check CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_cents  integer CONSTRAINT store_coupons_amount_check CHECK (amount_off_cents > 0),
  -- NULL = every product.
  product_id        uuid REFERENCES public.store_products (id),
  -- NULL = no limit.
  max_uses          integer CONSTRAINT store_coupons_max_uses_check CHECK (max_uses > 0),
  used_count        integer NOT NULL DEFAULT 0 CONSTRAINT store_coupons_used_count_check CHECK (used_count >= 0),
  expires_at        timestamptz,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_coupons_one_discount_check CHECK ((percent_off IS NULL) <> (amount_off_cents IS NULL)),
  CONSTRAINT store_coupons_within_max_check CHECK (max_uses IS NULL OR used_count <= max_uses)
);
CREATE UNIQUE INDEX IF NOT EXISTS store_coupons_code_idx ON public.store_coupons (code);
CREATE INDEX IF NOT EXISTS store_coupons_product_idx ON public.store_coupons (product_id) WHERE product_id IS NOT NULL;

-- One row per order that used a code. Removing a row gives the use back
-- (trigger in section 4), so ON DELETE CASCADE from the order is the release.
CREATE TABLE IF NOT EXISTS public.store_coupon_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id     uuid NOT NULL REFERENCES public.store_coupons (id),
  order_id      uuid NOT NULL REFERENCES public.store_orders (id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_coupon_redemptions_order_key UNIQUE (order_id)   -- one coupon per order
);
CREATE INDEX IF NOT EXISTS store_coupon_redemptions_coupon_idx ON public.store_coupon_redemptions (coupon_id);

-- Who made or changed a code, and what it was before. Written by trigger
-- only; the actor is auth.uid() (NULL for the service role). Nothing a
-- client sends can set these columns. No FK on coupon_id: the trail stays
-- even if a row is ever removed by hand.
CREATE TABLE IF NOT EXISTS public.store_coupon_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id  uuid NOT NULL,
  action     text NOT NULL CHECK (action IN ('create', 'update', 'activate', 'deactivate')),
  actor      uuid,
  at         timestamptz NOT NULL DEFAULT now(),
  old_row    jsonb,
  new_row    jsonb
);
CREATE INDEX IF NOT EXISTS store_coupon_audit_coupon_idx ON public.store_coupon_audit (coupon_id, at DESC);

-- ────────────────────────────────────────────────────────────
-- 2. Orders carry the coupon and the discount
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.store_coupons (id);
ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS store_orders_coupon_idx ON public.store_orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- 412 created the total and payment-method CHECKs without names. Drop our
-- named replacements first (so this migration can run twice), then find any
-- leftover 412 checks by what they say. Postgres may or may not wrap the
-- total equality in parentheses, so match both shapes. Never touch the
-- column checks (total_cents >= 0, status, fulfilment_method, …).
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_total_check;
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_payment_method_check;
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_discount_check;
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_free_check;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.store_orders'::regclass AND contype = 'c'
  LOOP
    IF (
          r.def ~ 'total_cents ='
      AND r.def ~ 'subtotal_cents'
      AND r.def ~ 'delivery_cents'
      AND r.def !~ 'discount_cents'
      AND r.def !~ '>= 0'
    ) OR (
          r.def ~ 'payment_method = ANY'
      AND r.def !~ '''free'''
    ) THEN
      EXECUTE format('ALTER TABLE public.store_orders DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END;
$$;

-- 'free' = an order a coupon brought to R0. Never sent to a payment provider.
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_payment_method_check
  CHECK (payment_method IN ('payfast', 'eft', 'stripe', 'free'));
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_total_check
  CHECK (total_cents = subtotal_cents + delivery_cents - discount_cents);
-- Discounts come off the merchandise only, never delivery, and only with a coupon.
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_discount_check
  CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents AND (discount_cents = 0 OR coupon_id IS NOT NULL));
-- A free order can only be paid when a coupon took it to exactly R0.
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_free_check
  CHECK (payment_method <> 'free' OR status <> 'paid' OR (total_cents = 0 AND coupon_id IS NOT NULL));
-- (total_cents >= 0 from 412 stays as it is.)

-- ────────────────────────────────────────────────────────────
-- 3. Coupon row guards + audit
-- ────────────────────────────────────────────────────────────
-- BEFORE: keep the code upper case, stamp who made it, keep created_* and
-- used_count out of staff hands, and lock what a code IS (code, discount,
-- product) once anyone has used it. Description, expiry, max uses and
-- active stay editable.
CREATE OR REPLACE FUNCTION public.store_coupons_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.code := upper(btrim(NEW.code));
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.used_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  IF OLD.used_count > 0 AND (
       NEW.code IS DISTINCT FROM OLD.code
    OR NEW.percent_off IS DISTINCT FROM OLD.percent_off
    OR NEW.amount_off_cents IS DISTINCT FROM OLD.amount_off_cents
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    RAISE EXCEPTION 'store_coupon_locked: % has been used; its code, discount and product can''t change', OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  -- Only a real edit moves updated_at; taking or giving back a use doesn't.
  IF (to_jsonb(NEW) - 'used_count' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'used_count' - 'updated_at') THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER: one audit row per create / edit / on-off. Uses taken or given back
-- (used_count only) aren't audited: the redemptions table is that record.
CREATE OR REPLACE FUNCTION public.store_coupons_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSE
    IF (to_jsonb(NEW) - 'used_count' - 'updated_at') = (to_jsonb(OLD) - 'used_count' - 'updated_at') THEN
      RETURN NULL;
    END IF;
    IF NEW.active IS DISTINCT FROM OLD.active
       AND (to_jsonb(NEW) - 'used_count' - 'updated_at' - 'active') = (to_jsonb(OLD) - 'used_count' - 'updated_at' - 'active') THEN
      v_action := CASE WHEN NEW.active THEN 'activate' ELSE 'deactivate' END;
    ELSE
      v_action := 'update';
    END IF;
  END IF;
  INSERT INTO public.store_coupon_audit (coupon_id, action, actor, old_row, new_row)
  VALUES (NEW.id, v_action, auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS store_coupons_before_write ON public.store_coupons;
CREATE TRIGGER store_coupons_before_write
  BEFORE INSERT OR UPDATE ON public.store_coupons
  FOR EACH ROW EXECUTE FUNCTION public.store_coupons_before_write();

DROP TRIGGER IF EXISTS store_coupons_audit ON public.store_coupons;
CREATE TRIGGER store_coupons_audit
  AFTER INSERT OR UPDATE ON public.store_coupons
  FOR EACH ROW EXECUTE FUNCTION public.store_coupons_audit();

-- ────────────────────────────────────────────────────────────
-- 4. Giving a use back
-- ────────────────────────────────────────────────────────────
-- Removing a redemption gives its use back. Cancelling an order removes its
-- redemption; deleting an order cascades to it. So every way an order stops
-- (admin cancel, PayFast / Stripe cancel, a checkout that fails after the
-- use was taken) releases the use, and only once.
CREATE OR REPLACE FUNCTION public.store_coupon_redemption_released()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.store_coupons
     SET used_count = used_count - 1
   WHERE id = OLD.coupon_id AND used_count > 0;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_order_cancel_releases_coupon()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.store_coupon_redemptions WHERE order_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS store_coupon_redemption_released ON public.store_coupon_redemptions;
CREATE TRIGGER store_coupon_redemption_released
  AFTER DELETE ON public.store_coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.store_coupon_redemption_released();

DROP TRIGGER IF EXISTS store_order_cancel_releases_coupon ON public.store_orders;
CREATE TRIGGER store_order_cancel_releases_coupon
  AFTER UPDATE OF status ON public.store_orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.coupon_id IS NOT NULL)
  EXECUTE FUNCTION public.store_order_cancel_releases_coupon();

-- ────────────────────────────────────────────────────────────
-- 5. Taking a use (service role only)
-- ────────────────────────────────────────────────────────────
-- Attach a code to a PENDING order the checkout route has just made. Locks
-- the coupon, re-checks everything against the order's own items (never the
-- client), and refuses with a reason instead of raising:
--   malformed · order · unknown · inactive · expired · used_up ·
--   wrong_product · changed (the discount isn't what the buyer was shown)
-- On 'ok' it has taken one use, written the redemption and stamped the
-- order, all in this one transaction.
--
-- Discount rule (same as src/lib/store/coupons.ts): merchandise only, never
-- delivery. A product-scoped code counts only that product's lines.
-- Percent: floor(eligible × percent / 100). Amount: min(amount, eligible).
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

REVOKE ALL ON FUNCTION public.store_apply_coupon(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_apply_coupon(uuid, text, integer) TO service_role;
-- Trigger functions: nobody calls these directly.
REVOKE ALL ON FUNCTION public.store_coupons_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_coupons_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_coupon_redemption_released() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_order_cancel_releases_coupon() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. Row level security
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.store_coupons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_coupon_audit       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store coupons: staff read" ON public.store_coupons;
DROP POLICY IF EXISTS "store coupons: managers insert" ON public.store_coupons;
DROP POLICY IF EXISTS "store coupons: managers update" ON public.store_coupons;
DROP POLICY IF EXISTS "store coupon redemptions: managers read" ON public.store_coupon_redemptions;
DROP POLICY IF EXISTS "store coupon audit: managers read" ON public.store_coupon_audit;

CREATE POLICY "store coupons: staff read"
  ON public.store_coupons FOR SELECT TO authenticated USING (public.store_can_view());
CREATE POLICY "store coupons: managers insert"
  ON public.store_coupons FOR INSERT TO authenticated WITH CHECK (public.store_can_manage());
CREATE POLICY "store coupons: managers update"
  ON public.store_coupons FOR UPDATE TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());
CREATE POLICY "store coupon redemptions: managers read"
  ON public.store_coupon_redemptions FOR SELECT TO authenticated USING (public.store_can_manage());
CREATE POLICY "store coupon audit: managers read"
  ON public.store_coupon_audit FOR SELECT TO authenticated USING (public.store_can_manage());

-- Table privileges (412's pattern): start from nothing, then grant what a
-- policy above allows. anon gets nothing. Staff write only the columns a
-- person sets; used_count, created_by and the timestamps are the
-- database's. Redemptions and the audit trail: SELECT only.
REVOKE ALL ON TABLE public.store_coupons, public.store_coupon_redemptions, public.store_coupon_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.store_coupons, public.store_coupon_redemptions, public.store_coupon_audit TO authenticated;
GRANT INSERT (code, description, percent_off, amount_off_cents, product_id, max_uses, expires_at, active)
  ON TABLE public.store_coupons TO authenticated;
GRANT UPDATE (code, description, percent_off, amount_off_cents, product_id, max_uses, expires_at, active)
  ON TABLE public.store_coupons TO authenticated;
GRANT ALL ON TABLE public.store_coupons, public.store_coupon_redemptions, public.store_coupon_audit TO service_role;

COMMIT;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('store_coupons', 'store_coupon_redemptions', 'store_coupon_audit');
--     -- expect relrowsecurity = true on all three
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.store_orders'::regclass AND contype = 'c' ORDER BY 1;
--     -- expect store_orders_total_check (… - discount_cents),
--     -- store_orders_payment_method_check (… 'free'), store_orders_discount_check,
--     -- store_orders_free_check, and no other total / payment_method check
--   SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type)
--     FROM information_schema.role_table_grants
--    WHERE table_name LIKE 'store\_coupon%' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
--    GROUP BY 1, 2 ORDER BY 1, 2;
--     -- expect authenticated: SELECT only (column INSERT / UPDATE on store_coupons
--     -- shows in column_privileges); no anon or PUBLIC rows
-- ============================================================
