-- ============================================================
-- FFSA Hub — Order refunds (end-to-end, money included)
-- ============================================================
-- Until now "Refund" on the Orders tab was a bookkeeping action:
-- it flipped orders.status to 'refunded', voided the tickets and
-- released inventory, but no money moved — staff had to refund in
-- PayFast separately. Nothing recorded whether they actually did.
--
-- This migration adds the ledger that makes real refunds possible:
-- one row per refund ATTEMPT, so a failed provider call is visible
-- rather than silently leaving the Hub and the provider disagreeing.
--
--   method = 'provider'  → we called Stripe / PayFast to move money
--   method = 'manual'    → staff refunded outside the Hub (EFT
--                          orders, legacy orders, provider refusals)
--                          and are recording it for the books
--
-- orders.refund_cents becomes the sum of SUCCEEDED rows here, which
-- is what finally makes the long-dormant 'partially_refunded' order
-- status reachable — both providers support partial refunds.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. order_refunds
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  amount_cents       integer NOT NULL CHECK (amount_cents > 0),
  reason             text,

  -- How the money moved (or didn't).
  method             text NOT NULL DEFAULT 'provider'
                     CHECK (method IN ('provider', 'manual')),

  -- Null for manual refunds — mirrors orders.payment_provider.
  provider           text CHECK (provider IS NULL OR provider IN ('payfast', 'stripe')),
  provider_refund_id text,

  -- 'pending' is a real resting state, not just a transient one:
  -- PayFast refunds settle asynchronously and there is no ITN for
  -- them, so a refund can sit here until someone syncs its status.
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_message      text,

  created_by         uuid REFERENCES public.users(id),
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_refunds_order
  ON public.order_refunds (order_id, created_at DESC);

-- Partial index for the "anything still awaiting the provider?" sweep.
CREATE INDEX IF NOT EXISTS idx_order_refunds_pending
  ON public.order_refunds (order_id)
  WHERE status = 'pending';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. RLS — mirrors public.orders exactly (migration 081), so
--    anyone who can see an order can see how it was refunded,
--    and anyone who can manage orders can refund one.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins, events, finance can read order refunds" ON public.order_refunds;
DROP POLICY IF EXISTS "Admins, events, finance can manage order refunds" ON public.order_refunds;

CREATE POLICY "Admins, events, finance can read order refunds"
  ON public.order_refunds FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_role('finance_admin')
    OR public.has_permission('events.view')
  );

CREATE POLICY "Admins, events, finance can manage order refunds"
  ON public.order_refunds FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_role('finance_admin')
    OR public.has_permission('events.manage_registrations')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_role('finance_admin')
    OR public.has_permission('events.manage_registrations')
  );

-- ────────────────────────────────────────────────────────────
-- 3. Backfill — every order already marked refunded predates this
--    table, and by definition was settled outside the Hub. Record
--    each as a succeeded manual refund so the new history panel
--    isn't blank on orders that were genuinely refunded, and so
--    sum(order_refunds) reconciles with orders.refund_cents.
--
--    created_by is left null: the old flow never recorded who did it.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.order_refunds (
  order_id, amount_cents, reason, method, status, completed_at, created_at
)
SELECT
  o.id,
  o.refund_cents,
  'Recorded before end-to-end refunds shipped — money was moved in the payment provider directly.',
  'manual',
  'succeeded',
  COALESCE(o.refunded_at, o.updated_at),
  COALESCE(o.refunded_at, o.updated_at)
FROM public.orders o
WHERE o.status IN ('refunded', 'partially_refunded')
  AND o.refund_cents > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.order_refunds r WHERE r.order_id = o.id
  );

COMMENT ON TABLE public.order_refunds IS
  'One row per refund attempt against an order. method=provider means the Hub called Stripe/PayFast to move the money; method=manual means staff refunded outside the Hub and recorded it. orders.refund_cents is the sum of status=succeeded rows.';

COMMENT ON COLUMN public.order_refunds.status IS
  'pending = submitted to the provider but not confirmed (PayFast settles asynchronously and sends no ITN for refunds; sync via the refund PATCH endpoint). succeeded = money moved. failed = provider rejected it; the order is left untouched.';
