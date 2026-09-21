-- ════════════════════════════════════════════════════════════
-- 222_vehicle_booking_visibility.sql
--
-- Vehicle bookings stop being readable by everyone with vehicles
-- access. From here a booking row is visible to the person who
-- requested it, the drivers named on it, and the vehicles team
-- (super admins + vehicles.approve / vehicles.manage).
--
-- Everyone else gets the fleet as a DAY-BY-DAY COUNT instead, via
-- vehicle_availability() — how many vans and cars are free, with no
-- names, statuses, purposes or head counts attached.
-- ════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. Visibility helpers
--
-- Both are SECURITY DEFINER on purpose. The policies below live on
-- vehicle_bookings, vehicle_booking_assignments and
-- vehicle_booking_drivers and need to ask about each OTHER's rows;
-- doing that through a plain subquery re-enters the referenced
-- table's own policy and recurses. A definer function reads past
-- RLS and breaks the cycle.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.owns_vehicle_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_bookings b
    WHERE b.id = p_booking_id
      AND b.requested_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.drives_vehicle_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_booking_drivers d
    WHERE d.vehicle_booking_id = p_booking_id
      AND d.user_id = auth.uid()
  );
$$;

-- The vehicles team, for read purposes.
CREATE OR REPLACE FUNCTION public.manages_vehicles()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission('vehicles.approve')
      OR public.has_permission('vehicles.manage');
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Narrow the three read policies
--
-- Was: has_vehicles_access() on all three — i.e. every Hub user,
-- since the self_service floor grants vehicles.view to everyone.
-- The drivers table was the worst of it: licence numbers and expiry
-- dates were world-readable inside the Hub.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "vehicle_bookings_read" ON public.vehicle_bookings;
CREATE POLICY "vehicle_bookings_read" ON public.vehicle_bookings
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR requested_by = auth.uid()
    OR public.drives_vehicle_booking(id)
  );

DROP POLICY IF EXISTS "vba_read" ON public.vehicle_booking_assignments;
CREATE POLICY "vba_read" ON public.vehicle_booking_assignments
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

DROP POLICY IF EXISTS "vbd_read" ON public.vehicle_booking_drivers;
CREATE POLICY "vbd_read" ON public.vehicle_booking_drivers
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

-- ────────────────────────────────────────────────────────────
-- 2b. The same narrowing for everything hanging off a booking
--
-- These four were left on has_vehicles_access() by 104/105/106 and are the
-- worse half of the leak: typed signatures and the IP they were signed from,
-- payment amounts and PayFast references, odometer readings and damage
-- declarations, and the file rows pointing at licence and damage photos.
-- None of that is fleet-availability information.
--
-- Write policies are left exactly as they were — only reads change here.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "vins_read" ON public.vehicle_inspections;
CREATE POLICY "vins_read" ON public.vehicle_inspections
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

DROP POLICY IF EXISTS "vinf_read" ON public.vehicle_inspection_files;
CREATE POLICY "vinf_read" ON public.vehicle_inspection_files
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

DROP POLICY IF EXISTS "vpay_read" ON public.vehicle_payments;
CREATE POLICY "vpay_read" ON public.vehicle_payments
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

DROP POLICY IF EXISTS "vag_read" ON public.vehicle_agreements;
CREATE POLICY "vag_read" ON public.vehicle_agreements
  FOR SELECT TO authenticated
  USING (
    public.manages_vehicles()
    OR public.owns_vehicle_booking(vehicle_booking_id)
    OR public.drives_vehicle_booking(vehicle_booking_id)
  );

-- ────────────────────────────────────────────────────────────
-- 3. Per-day availability — the one thing everyone may see
--
-- Returns a row per day per vehicle type over [p_from, p_to]:
--   total           active vehicles of that type in the fleet
--   confirmed_used  held by an APPROVED booking covering that day
--   pending_used    held by a PENDING (unapproved) request
--
-- confirmed_used is what the calendar subtracts; pending_used is
-- surfaced as a softer "also requested" hint. A given vehicle can
-- only appear once per day across the two, because assigning the
-- same vehicle to two overlapping live bookings is already a hard
-- block in the API.
--
-- SECURITY DEFINER so it can count rows the caller may no longer
-- read. It returns counts only — never a booking id, name or status
-- — and the has_vehicles_access() guard keeps it inside the module.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vehicle_availability(p_from date, p_to date)
RETURNS TABLE (
  day             date,
  vehicle_type    text,
  total           integer,
  confirmed_used  integer,
  pending_used    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT d.d::date AS day
    FROM generate_series(
      p_from::timestamp, p_to::timestamp, interval '1 day'
    ) AS d(d)
  ),
  types AS (
    SELECT t.vehicle_type
    FROM unnest(ARRAY['van', 'car']::text[]) AS t(vehicle_type)
  ),
  fleet AS (
    SELECT v.vehicle_type, count(*)::int AS total
    FROM public.vehicles v
    WHERE v.status = 'active'
    GROUP BY v.vehicle_type
  ),
  used AS (
    SELECT
      dd.day,
      v.vehicle_type,
      b.status,
      count(DISTINCT a.vehicle_id)::int AS n
    FROM days dd
    JOIN public.vehicle_bookings b
      ON b.checkout_date <= dd.day
     AND b.return_date   >= dd.day
     AND b.status IN ('pending', 'approved')
    JOIN public.vehicle_booking_assignments a
      ON a.vehicle_booking_id = b.id
    JOIN public.vehicles v
      ON v.id = a.vehicle_id
     AND v.status = 'active'
    GROUP BY dd.day, v.vehicle_type, b.status
  )
  SELECT
    dd.day,
    t.vehicle_type,
    COALESCE(f.total, 0) AS total,
    COALESCE(
      (SELECT u.n FROM used u
        WHERE u.day = dd.day AND u.vehicle_type = t.vehicle_type
          AND u.status = 'approved'), 0
    ) AS confirmed_used,
    COALESCE(
      (SELECT u.n FROM used u
        WHERE u.day = dd.day AND u.vehicle_type = t.vehicle_type
          AND u.status = 'pending'), 0
    ) AS pending_used
  FROM days dd
  CROSS JOIN types t
  LEFT JOIN fleet f ON f.vehicle_type = t.vehicle_type
  WHERE public.has_vehicles_access()
  ORDER BY dd.day, t.vehicle_type;
$$;

REVOKE EXECUTE ON FUNCTION public.vehicle_availability(date, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.vehicle_availability(date, date) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- Verify:
--   SELECT * FROM public.vehicle_availability(
--     date_trunc('month', now())::date,
--     (date_trunc('month', now()) + interval '1 month - 1 day')::date
--   );
-- ────────────────────────────────────────────────────────────
