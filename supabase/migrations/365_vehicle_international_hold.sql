-- ============================================================
-- FFSA Hub — Migration 365: the hold after an International Team booking
-- ============================================================
-- Requires 222, 356. Independent of 364.
--
-- Gideon, 24 Nov 2026: when an international team books vehicles, the vehicles are
-- kept back for 3 working days after the due-back day, for the post-rental inspection
-- and a full valet wash. Working days are Mon–Fri and not South African public
-- holidays; weekends and holidays inside that stretch are held too: due back Friday
-- → held Saturday to Wednesday, free on Thursday. The Vehicle
-- Coordinator can release a hold, with a note saying why.
--
-- The hold isn't stored as rows: it follows from the booking's purpose
-- ('international_team') and return_date, so an early return or a date change moves
-- it. vehicle_hold_end() is the same arithmetic as src/lib/vehicles/hold.ts.
--
-- vehicle_availability() (222, 356) counts a held vehicle as taken, also once the
-- booking is completed (the valet may not be done yet). Migration 359
-- (Fleet history, PR #709) also re-creates that function, to skip hidden workshop
-- visits. This file keeps that line when 359's column is there, so apply 365 AFTER
-- 359; if 359 is applied later, run this file again (it's safe to re-run).
--
-- Safe to re-run, one transaction; no anon or PUBLIC grants.
-- ============================================================

BEGIN;

-- ── Releasing a hold ──────────────────────────────────────────
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS hold_released_at   timestamptz,
  ADD COLUMN IF NOT EXISTS hold_released_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_release_note  text;

ALTER TABLE public.vehicle_bookings DROP CONSTRAINT IF EXISTS vehicle_bookings_hold_release_note_check;
ALTER TABLE public.vehicle_bookings ADD CONSTRAINT vehicle_bookings_hold_release_note_check
  CHECK (hold_released_at IS NULL OR length(btrim(coalesce(hold_release_note, ''))) > 0);

-- The person who booked can update their own booking (103); only vehicle managers
-- (or the server, as service role) release a hold.
CREATE OR REPLACE FUNCTION public.vehicle_bookings_guard_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin()
     OR public.has_permission('vehicles.approve')
     OR public.has_permission('vehicles.manage') THEN
    RETURN NEW;
  END IF;
  IF NEW.hold_released_at IS DISTINCT FROM OLD.hold_released_at
     OR NEW.hold_released_by IS DISTINCT FROM OLD.hold_released_by
     OR NEW.hold_release_note IS DISTINCT FROM OLD.hold_release_note THEN
    RAISE EXCEPTION 'Only the Vehicle Coordinator can release a hold' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_bookings_guard_hold ON public.vehicle_bookings;
CREATE TRIGGER vehicle_bookings_guard_hold
  BEFORE UPDATE ON public.vehicle_bookings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_bookings_guard_hold();

-- A trigger function is never called directly: nobody needs EXECUTE (Jack's review of #712).
REVOKE EXECUTE ON FUNCTION public.vehicle_bookings_guard_hold() FROM PUBLIC, anon, authenticated;

-- ── South African public holidays, by rule (src/lib/vehicles/sa-holidays.ts) ──
-- Fixed days, Good Friday and Family Day, and the Monday after a fixed holiday that
-- falls on a Sunday (Public Holidays Act 36 of 1994, s2(1)). One-off declared days
-- (election days) aren't rules and aren't here.
CREATE OR REPLACE FUNCTION public.easter_sunday(p_year integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  h int;
  l int;
  m int;
BEGIN
  h := (19 * a + b - b / 4 - (b - (b + 8) / 25 + 1) / 3 + 15) % 30;
  l := (32 + 2 * (b % 4) + 2 * (c / 4) - h - c % 4) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  RETURN make_date(p_year, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.sa_public_holiday(p_day date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT to_char(p_day, 'MM-DD') IN ('01-01','03-21','04-27','05-01','06-16','08-09','09-24','12-16','12-25','12-26')
      OR p_day IN (public.easter_sunday(extract(year FROM p_day)::int) - 2,
                   public.easter_sunday(extract(year FROM p_day)::int) + 1)
      OR (extract(isodow FROM p_day) = 1
          AND to_char(p_day - 1, 'MM-DD') IN ('01-01','03-21','04-27','05-01','06-16','08-09','09-24','12-16','12-25','12-26'));
$$;

-- ── The last held day: the 3rd working day after the due-back day ──
-- Working day: Mon–Fri and not a public holiday.
CREATE OR REPLACE FUNCTION public.vehicle_hold_end(p_return date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT g.d::date
  FROM generate_series(p_return + 1, p_return + 21, interval '1 day') AS g(d)
  WHERE extract(isodow FROM g.d) < 6
    AND NOT public.sa_public_holiday(g.d::date)
  ORDER BY g.d
  OFFSET 2
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.easter_sunday(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_public_holiday(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.vehicle_hold_end(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.easter_sunday(integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.sa_public_holiday(date) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.vehicle_hold_end(date) TO authenticated, service_role;

-- ── Availability counts a held vehicle as taken ───────────────
-- Same as 356 (and 359 when its column exists) except the booking's last day.
DO $outer$
DECLARE
  hidden_visits text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_workshop_visits' AND column_name = 'deleted_at'
  ) THEN
    hidden_visits := ' AND w.deleted_at IS NULL';
  END IF;

  EXECUTE format($fn$
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
  -- Which vehicle is taken on which day, and how: approved bookings (with an
  -- International Team booking's hold) and booked workshop visits are 'approved';
  -- pending bookings are 'pending'.
  taken AS (
    -- The hold outlasts completion: the valet may not be done yet.
    SELECT dd.day, a.vehicle_id, CASE WHEN b.status = 'completed' THEN 'approved' ELSE b.status END
    FROM days dd
    JOIN public.vehicle_bookings b
      ON b.checkout_date <= dd.day
     AND (
          (b.status IN ('pending', 'approved') AND b.return_date >= dd.day)
       OR (b.status IN ('pending', 'approved', 'completed')
           AND b.purpose = 'international_team'
           AND b.hold_released_at IS NULL
           AND b.return_date < dd.day
           AND public.vehicle_hold_end(b.return_date) >= dd.day)
     )
    JOIN public.vehicle_booking_assignments a
      ON a.vehicle_booking_id = b.id
    UNION
    SELECT dd.day, w.vehicle_id, 'approved'
    FROM days dd
    JOIN public.fleet_workshop_visits w
      ON w.status = 'booked'%s
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
$fn$, hidden_visits);
END
$outer$;

REVOKE EXECUTE ON FUNCTION public.vehicle_availability(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.vehicle_availability(date, date) TO authenticated, service_role;

COMMIT;
