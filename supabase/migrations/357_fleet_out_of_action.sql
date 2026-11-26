-- ════════════════════════════════════════════════════════════
-- 357_fleet_out_of_action.sql  (Fleet part 5c: repairs and breakdowns
-- on bookings in progress; Gideon, 19 Nov 2026)
--
-- 1. A vehicle that's at the workshop or off the road can't be booked.
--    When Fleet's status for a vehicle becomes "In workshop" or "Off the
--    road", the Hub's vehicles.status goes from 'active' to 'maintenance'
--    and stays there, with no end date, until Fleet marks it back ("In
--    service", "On a trip" or "Booked for workshop"); then it's 'active'
--    again. It only ever moves between active and maintenance: a retired
--    vehicle, and Fleet's "For sale", are left alone. This is the part of
--    the status mapping in #623's description that Gideon asked for; it's
--    done here, in the database, so every way Fleet changes a status
--    (Dropped off, Collected, the vehicle page, a post-trip check) counts.
--
-- 2. A booking can be put ON HOLD while its vehicle is out of action and no
--    similar vehicle is free: it stays approved, with on_hold_since and
--    on_hold_reason set, until the co-ordinator resumes it. The status
--    vocabulary of vehicle_bookings doesn't change, and nothing reads the
--    new columns unless it's looking for them.
--
-- Additive, one transaction, safe to re-run. Requires 103, 350.
-- ════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS on_hold_since  date,
  ADD COLUMN IF NOT EXISTS on_hold_reason text;

COMMENT ON COLUMN public.vehicle_bookings.on_hold_since IS
  'Fleet 5c: the day the booking was put on hold because its vehicle is out of action and no similar vehicle is free. NULL = not on hold.';
COMMENT ON COLUMN public.vehicle_bookings.on_hold_reason IS
  'Fleet 5c: why the booking is on hold, as told to the person who booked.';

-- Fleet's status → the Hub's vehicles.status (active ↔ maintenance only), on a
-- change of status only: creating or seeding a row never touches the Hub's status.
CREATE OR REPLACE FUNCTION public.fleet_sync_vehicle_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.fleet_status IS NOT DISTINCT FROM OLD.fleet_status THEN
    RETURN NEW;
  END IF;
  IF NEW.fleet_status IN ('In workshop', 'Off the road') THEN
    UPDATE public.vehicles SET status = 'maintenance'
     WHERE id = NEW.vehicle_id AND status = 'active';
  ELSIF NEW.fleet_status IN ('In service', 'On a trip', 'Booked for workshop') THEN
    UPDATE public.vehicles SET status = 'active'
     WHERE id = NEW.vehicle_id AND status = 'maintenance';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_sync_vehicle_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fleet_sync_vehicle_status ON public.fleet_vehicle_details;
CREATE TRIGGER fleet_sync_vehicle_status
  AFTER UPDATE OF fleet_status ON public.fleet_vehicle_details
  FOR EACH ROW EXECUTE FUNCTION public.fleet_sync_vehicle_status();

COMMIT;
