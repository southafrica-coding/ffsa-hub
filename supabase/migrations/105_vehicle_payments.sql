-- ============================================================
-- FFSA Hub — Migration 105: Vehicle rental payments + Xero codes (v3)
-- ============================================================
-- Online card payment for a vehicle rental, reusing the existing
-- PayFast provider (ZAR), plus a manager-controlled Xero item code
-- per vehicle — mirroring how school billing items carry an
-- `xero_item_code` that routes income to the right Xero ledger
-- account (see services/xero.ts createScheduledInvoice).
--
--   vehicles.xero_item_code  — per-vehicle code, edited in Fleet admin
--   vehicle_payments         — one PayFast charge per booking
--
-- The checkout + webhook routes use the service-role client, so no
-- public write policy is required here. Requires migration 103.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Per-vehicle Xero item code (manager-controlled)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS xero_item_code text;

-- ────────────────────────────────────────────────────────────
-- 2. PAYMENTS
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id  uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  amount_cents        integer NOT NULL,            -- charged amount in ZAR cents
  currency            text NOT NULL DEFAULT 'ZAR',
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'cancelled', 'failed', 'refunded')),
  payment_provider    text NOT NULL DEFAULT 'payfast',
  provider_reference  text,                        -- round-trips via the ITN
  provider_payment_id text,                        -- provider-side payment id
  description         text,
  xero_item_code      text,                        -- snapshot of the vehicle's code
  xero_invoice_id     text,
  xero_invoice_number text,
  created_by          uuid REFERENCES public.users (id),
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_payments_booking ON public.vehicle_payments (vehicle_booking_id);
CREATE INDEX idx_vehicle_payments_status  ON public.vehicle_payments (status);
CREATE UNIQUE INDEX idx_vehicle_payments_provider_reference
  ON public.vehicle_payments (provider_reference) WHERE provider_reference IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
-- Reads for anyone with module access; the checkout + webhook routes
-- write via the service-role client (which bypasses RLS), so the write
-- policy only covers any future direct client writes.

ALTER TABLE public.vehicle_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vpay_read" ON public.vehicle_payments
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vpay_write" ON public.vehicle_payments
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
    OR EXISTS (SELECT 1 FROM public.vehicle_bookings b
                WHERE b.id = vehicle_booking_id AND b.requested_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
    OR EXISTS (SELECT 1 FROM public.vehicle_bookings b
                WHERE b.id = vehicle_booking_id AND b.requested_by = auth.uid())
  );

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'vehicles' AND column_name = 'xero_item_code';
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'vehicle_payments';
-- ============================================================
