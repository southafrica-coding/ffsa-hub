-- ============================================================
-- FFSA Hub — Migration 359: Fleet — nothing in a vehicle's history is erased
-- ============================================================
-- Requires 350, 351 and 356 (and 358 before it, in order).
--
-- "All history of the vehicles is kept" (Gideon, 23 Nov 2026). Deleting an
-- inspection, a workshop visit or a km reading in Fleet used to remove the row.
-- Now "delete" only hides it: deleted_at and deleted_by are set, the Hub stops
-- showing it, and the row stays in the database for good.
--
--   • Read: Fleet users see only rows that aren't deleted (as 351, plus
--     deleted_at IS NULL), so every page and report leaves them out without
--     code changes.
--   • Update: Fleet managers, only on rows that aren't deleted (a hidden row
--     can't be edited or brought back from the Hub).
--   • Delete: no policy and no grant for authenticated: nobody can erase a row
--     from the Hub. Only the service role (the database's admin) can.
--   • Availability: vehicle_availability (356) skips hidden workshop visits.
--   • Hiding: public.fleet_hide_row(table, id), a SECURITY DEFINER function, sets
--     deleted_at = now() and deleted_by = auth.uid() for Fleet managers, on these
--     three tables only. (A plain UPDATE can't: Postgres checks the new row against
--     the read policy, and a hidden row no longer passes it.)
--
-- Safe to re-run, one transaction; no anon or PUBLIC grants (as 351).
-- ============================================================

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fleet_inspections', 'fleet_workshop_visits', 'fleet_odometer_readings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.views_fleet() AND deleted_at IS NULL)',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.manages_fleet() AND deleted_at IS NULL) WITH CHECK (public.manages_fleet())',
      t || '_update', t);

    EXECUTE format('REVOKE DELETE ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_hide_row(p_table text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.manages_fleet() THEN
    RAISE EXCEPTION 'Only Fleet managers can delete Fleet records' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN ('fleet_inspections', 'fleet_workshop_visits', 'fleet_odometer_readings') THEN
    RAISE EXCEPTION 'Unknown Fleet table: %', p_table USING ERRCODE = '22023';
  END IF;
  EXECUTE format('UPDATE public.%I SET deleted_at = now(), deleted_by = auth.uid() WHERE id = $1 AND deleted_at IS NULL', p_table)
    USING p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_hide_row(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_hide_row(text, uuid) TO authenticated, service_role;

-- The day-by-day availability counts (356) read visits as the function's owner, past
-- RLS, so they must leave hidden visits out themselves. Same as 356 plus one line.
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
SET search_path = ''
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
  -- Which vehicle is taken on which day, and how: approved bookings and
  -- booked workshop visits are 'approved'; pending bookings are 'pending'.
  taken AS (
    SELECT dd.day, a.vehicle_id, b.status
    FROM days dd
    JOIN public.vehicle_bookings b
      ON b.checkout_date <= dd.day
     AND b.return_date   >= dd.day
     AND b.status IN ('pending', 'approved')
    JOIN public.vehicle_booking_assignments a
      ON a.vehicle_booking_id = b.id
    UNION
    SELECT dd.day, w.vehicle_id, 'approved'
    FROM days dd
    JOIN public.fleet_workshop_visits w
      ON w.status = 'booked'
     AND w.date <= dd.day
     AND COALESCE(GREATEST(w.until, w.date), w.date) >= dd.day
     AND w.deleted_at IS NULL   -- 359: a hidden (deleted) visit blocks nothing
  ),
  used AS (
    SELECT t.day, v.vehicle_type, t.status, count(DISTINCT t.vehicle_id)::int AS n
    FROM taken t
    JOIN public.vehicles v
      ON v.id = t.vehicle_id
     AND v.status = 'active'
    -- A vehicle both pending and in the workshop counts once, as confirmed.
    WHERE t.status = 'approved'
       OR NOT EXISTS (
         SELECT 1 FROM taken t2
         WHERE t2.day = t.day AND t2.vehicle_id = t.vehicle_id AND t2.status = 'approved'
       )
    GROUP BY t.day, v.vehicle_type, t.status
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

REVOKE EXECUTE ON FUNCTION public.vehicle_availability(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.vehicle_availability(date, date) TO authenticated, service_role;

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('fleet_inspections','fleet_workshop_visits','fleet_odometer_readings') ORDER BY 1, 3;
--   -- no DELETE for authenticated:
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'authenticated' AND table_name IN ('fleet_inspections','fleet_workshop_visits','fleet_odometer_readings');
--   -- what was hidden, and by whom (service role / SQL Editor):
--   SELECT id, vehicle_id, deleted_at, deleted_by FROM public.fleet_inspections WHERE deleted_at IS NOT NULL;
