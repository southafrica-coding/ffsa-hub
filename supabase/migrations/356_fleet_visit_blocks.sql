-- ════════════════════════════════════════════════════════════
-- 356_fleet_visit_blocks.sql  (Fleet PR 5a, SPEC 7.3)
--
-- A booked workshop visit blocks its vehicle from `date` to `until`.
-- The API's clash check already counts them (getOverlappingAssignments);
-- this makes the day-by-day availability counts agree: a vehicle in for
-- a booked visit counts as confirmed-used that day.
--
-- Same function as 222 otherwise, hardened like 350–353 (Jack's review,
-- 18 Nov): search_path is empty and every name is schema-qualified, EXECUTE
-- is revoked from PUBLIC and anon, and the file is one transaction, safe to
-- re-run. Planned as 354, but main has since used 354 and 355, so Fleet's
-- bookings migration is 356. Requires 222, 350.
-- ════════════════════════════════════════════════════════════

BEGIN;

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
