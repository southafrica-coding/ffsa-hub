-- ============================================================
-- FFSA Hub — Migration 104: Vehicle inspections (Rent a Vehicle v2)
-- ============================================================
-- Digitises the BASE VEHICLES "Sign Out" (collection) and "Sign In"
-- (return) forms: mileage in/out, walk-around damage map, inventory
-- check, wash/fuel/damage declarations, plus driver-licence and damage
-- photo uploads into a PRIVATE storage bucket (signed-URL viewing only).
--
--   vehicle_inspections       — one collection/return record per vehicle
--   vehicle_inspection_files  — damage photos + licence copies (storage paths)
--   bucket 'vehicle-inspections' (private; images + pdf)
--
-- Uploads go through an admin-client API route (service role), like the
-- avatars/receipts buckets, so no storage.objects policy is needed.
-- Requires migration 103. Access mirrors the 103 child-table policies.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. INSPECTIONS
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_inspections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  vehicle_id         uuid REFERENCES public.vehicles (id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('collection', 'return')),
  driver_names       text,
  mileage            integer,
  fuel_full          boolean,        -- returned full of the correct fuel
  washed             boolean,        -- washed inside & out (with receipt)
  damage_reported    boolean,        -- all damage reported to the coordinator
  damage_panels      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ["front_bumper", ...]
  inventory          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"car_jack": true, ...}
  condition_notes    text,
  declaration_agreed boolean NOT NULL DEFAULT false,      -- agreed to the T&C
  performed_by       uuid REFERENCES public.users (id),
  performed_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_inspections_booking ON public.vehicle_inspections (vehicle_booking_id);

-- ────────────────────────────────────────────────────────────
-- 2. INSPECTION FILES (damage photos + licence copies)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_inspection_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  inspection_id      uuid REFERENCES public.vehicle_inspections (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('damage_photo', 'license')),
  file_path          text NOT NULL,    -- storage path in 'vehicle-inspections'
  file_name          text,
  uploaded_by        uuid REFERENCES public.users (id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_inspection_files_booking ON public.vehicle_inspection_files (vehicle_booking_id);

-- ────────────────────────────────────────────────────────────
-- 3. STORAGE BUCKET (private)
-- ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-inspections',
  'vehicle-inspections',
  false,
  10485760,  -- 10 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY (mirrors the 103 child-table policies)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_inspection_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vins_read" ON public.vehicle_inspections
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vins_write" ON public.vehicle_inspections
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

CREATE POLICY "vinf_read" ON public.vehicle_inspection_files
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vinf_write" ON public.vehicle_inspection_files
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
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'vehicle-inspections';
--   SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE tablename IN ('vehicle_inspections','vehicle_inspection_files') ORDER BY tablename, cmd;
-- ============================================================
