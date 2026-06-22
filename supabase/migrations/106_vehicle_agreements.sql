-- ============================================================
-- FFSA Hub — Migration 106: Vehicle policy e-signature (v3)
-- ============================================================
-- Captures a renter's acceptance of the FFSA Vehicle Usage Policy &
-- Agreement against a booking — a typed signature + timestamp +
-- policy version, as a click/type-wrap e-signature record.
-- Requires migration 103.
-- ============================================================

CREATE TABLE public.vehicle_agreements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  signer_name        text NOT NULL,
  signer_email       text,
  typed_signature    text NOT NULL,     -- the name typed as the signature
  policy_version     text NOT NULL,     -- which policy text was agreed to
  agreed             boolean NOT NULL DEFAULT true,
  ip_address         text,
  signed_by          uuid REFERENCES public.users (id),
  signed_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_agreements_booking ON public.vehicle_agreements (vehicle_booking_id);

ALTER TABLE public.vehicle_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vag_read" ON public.vehicle_agreements
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vag_write" ON public.vehicle_agreements
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
-- Validation
-- ------------------------------------------------------------
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'vehicle_agreements';
-- ============================================================
