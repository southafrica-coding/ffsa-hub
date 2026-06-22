-- ============================================================
-- FFSA Hub — Migration 103: Rent a Vehicle module (Bookings hub)
-- ============================================================
-- Replaces the "BASE VEHICLES" Google Drive operation with a real
-- module living beside Space Bookings under the /bookings hub.
--
--   vehicles                    — the base fleet (was: the booking sheet's plates)
--   vehicle_bookings            — one request per team/person/booking
--   vehicle_booking_assignments — which vehicle(s) a booking holds (availability)
--   vehicle_booking_drivers     — drivers per booking (licence + test status)
--
-- Permissions (module = 'vehicles'):
--   vehicles.view     — see fleet + bookings
--   vehicles.request  — create booking requests
--   vehicles.approve  — approve / deny / complete requests (Vehicle Coordinator)
--   vehicles.manage   — manage the fleet & settings
--
-- Mirrors the Space Bookings access model (088): is_admin() + has_permission()
-- helpers already exist (002 / 015). v1 = booking engine; inspections (v2) and
-- the Finance link / e-signature (v3) land in later migrations.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Shared access helper — true if the user can see the module
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_vehicles_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission('vehicles.view')
      OR public.has_permission('vehicles.request')
      OR public.has_permission('vehicles.approve')
      OR public.has_permission('vehicles.manage');
$$;

-- ────────────────────────────────────────────────────────────
-- 1. VEHICLES (the base fleet)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,                 -- "Hyundai H1"
  vehicle_type       text NOT NULL DEFAULT 'van'
                     CHECK (vehicle_type IN ('van', 'car')),
  make_model         text,                          -- "Hyundai H1"
  fuel_type          text CHECK (fuel_type IN ('diesel', 'petrol')),
  seats              integer,
  registration_plate text UNIQUE,                   -- "KVS 119 NW"
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'maintenance', 'retired')),
  color              text NOT NULL DEFAULT '#0ea5e9',
  notes              text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_by         uuid REFERENCES public.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. VEHICLE BOOKINGS (one per team / person / request)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_name        text NOT NULL,                -- "FF Kona | Youth Team"
  point_person        text,                         -- POINT PERSON (free text in v1)
  purpose             text NOT NULL DEFAULT 'ministry'
                      CHECK (purpose IN ('international_team', 'ministry',
                                         'airport_run', 'personal', 'other')),
  purpose_note        text,                         -- detail when purpose = other
  requester_name      text,
  requester_email     text,
  requester_phone     text,                         -- WhatsApp-compatible
  num_people          integer,
  checkout_date       date NOT NULL,                -- collection
  return_date         date NOT NULL,                -- return
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'denied',
                                        'cancelled', 'completed')),
  decision_note       text,
  -- In-module payment tracking (Finance link comes in v3).
  pricing_per_day     numeric(10,2),
  currency            text NOT NULL DEFAULT 'USD',
  total_amount        numeric(10,2),
  payment_required    boolean NOT NULL DEFAULT false,
  payment_received    boolean NOT NULL DEFAULT false,
  payment_received_at timestamptz,
  notes               text,
  requested_by        uuid REFERENCES public.users (id),
  decided_by          uuid REFERENCES public.users (id),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_bookings_dates CHECK (return_date >= checkout_date)
);

-- ────────────────────────────────────────────────────────────
-- 3. ASSIGNMENTS (which vehicle(s) a booking holds)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_booking_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  vehicle_id         uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_booking_id, vehicle_id)
);

-- ────────────────────────────────────────────────────────────
-- 4. DRIVERS (per booking — licence + driving-test status)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_booking_drivers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id  uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  name                text NOT NULL,
  phone               text,
  has_sa_license      boolean NOT NULL DEFAULT false,
  is_first_time       boolean NOT NULL DEFAULT false, -- never driven a base vehicle → driving test
  driving_test_status text NOT NULL DEFAULT 'not_required'
                      CHECK (driving_test_status IN ('not_required', 'pending',
                                                     'passed', 'failed')),
  license_file_url    text,                           -- v2 upload
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 5. INDEXES
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_vehicle_bookings_dates  ON public.vehicle_bookings (checkout_date, return_date);
CREATE INDEX idx_vehicle_bookings_status ON public.vehicle_bookings (status);
CREATE INDEX idx_vba_booking ON public.vehicle_booking_assignments (vehicle_booking_id);
CREATE INDEX idx_vba_vehicle ON public.vehicle_booking_assignments (vehicle_id);
CREATE INDEX idx_vbd_booking ON public.vehicle_booking_drivers (vehicle_booking_id);

-- ────────────────────────────────────────────────────────────
-- 6. PERMISSIONS (master list)
-- ────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('vehicles', 'vehicles.view',    'View Vehicle Bookings',          10),
  ('vehicles', 'vehicles.request', 'Request Vehicle Bookings',       20),
  ('vehicles', 'vehicles.approve', 'Approve / Deny Vehicle Bookings', 30),
  ('vehicles', 'vehicles.manage',  'Manage Fleet & Settings',        40)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.vehicles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_booking_drivers     ENABLE ROW LEVEL SECURITY;

-- ── vehicles ───────────────────────────────────────────────
CREATE POLICY "vehicles_read" ON public.vehicles
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vehicles_manage" ON public.vehicles
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_permission('vehicles.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('vehicles.manage'));

-- ── vehicle_bookings ───────────────────────────────────────
CREATE POLICY "vehicle_bookings_read" ON public.vehicle_bookings
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vehicle_bookings_insert" ON public.vehicle_bookings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('vehicles.request')
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
  );

CREATE POLICY "vehicle_bookings_update" ON public.vehicle_bookings
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
    OR requested_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
    OR requested_by = auth.uid()
  );

CREATE POLICY "vehicle_bookings_delete" ON public.vehicle_bookings
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.has_permission('vehicles.manage')
    OR requested_by = auth.uid()
  );

-- ── assignments & drivers (child tables) ───────────────────
-- Read for anyone with module access; writes for approvers/managers or the
-- owner of the parent booking.
CREATE POLICY "vba_read" ON public.vehicle_booking_assignments
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vba_write" ON public.vehicle_booking_assignments
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

CREATE POLICY "vbd_read" ON public.vehicle_booking_drivers
  FOR SELECT TO authenticated
  USING (public.has_vehicles_access());

CREATE POLICY "vbd_write" ON public.vehicle_booking_drivers
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

-- ────────────────────────────────────────────────────────────
-- 8. SEED — the 6 base vehicles (from the BOOKING SYSTEM sheet plates)
-- ────────────────────────────────────────────────────────────

INSERT INTO public.vehicles
  (name, vehicle_type, make_model, fuel_type, seats, registration_plate, color, sort_order) VALUES
  ('VW Bus (Kombi)', 'van', 'VW Kombi',      'diesel', 8, 'KLK 556 NW', '#0ea5e9', 10),
  ('Hyundai H1',     'van', 'Hyundai H1',    'diesel', 9, 'KVS 119 NW', '#6366f1', 20),
  ('Hyundai H2',     'van', 'Hyundai H2',    'diesel', 9, 'JYD 637 NW', '#8b5cf6', 30),
  ('Hyundai H3',     'van', 'Hyundai H3',    'diesel', 9, 'KPH 387 NW', '#a855f7', 40),
  ('Honda CRV',      'car', 'Honda CRV',     'petrol', 5, 'KKC 267 NW', '#10b981', 50),
  ('Nissan Almera',  'car', 'Nissan Almera', 'petrol', 5, 'KPC 152 NW', '#f59e0b', 60)
ON CONFLICT (registration_plate) DO NOTHING;

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT key, display_name FROM public.permissions WHERE module = 'vehicles';
--   SELECT name, vehicle_type, fuel_type, registration_plate FROM public.vehicles ORDER BY sort_order;
--   SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE tablename LIKE 'vehicle%' ORDER BY tablename, cmd;
-- ============================================================
