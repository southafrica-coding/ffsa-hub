-- ============================================================================
-- 108 — Prayer Room: allow one person to hold MULTIPLE roles in the same set
-- ============================================================================
-- Before this migration a person could not be rostered into two slots of the
-- SAME set (e.g. Vocals AND Instrument) because the `no_double_booking`
-- EXCLUDE constraint treated both filled slots as an overlap — they share the
-- set's single time range.
--
-- We still want to prevent a person being booked into two DIFFERENT sets at
-- overlapping times (you can't be in two places at once). A GiST EXCLUDE
-- constraint can't express "overlap only when set_id differs" (no support for
-- the <> operator), so we replace it with a BEFORE trigger that performs the
-- same check but scoped to *other* sets.
--
-- The trigger raises SQLSTATE 23P01 (exclusion_violation) so the existing
-- acceptInvite() handler in src/services/prayer-room.ts keeps surfacing its
-- friendly "already serving in another set" message with no code change.
-- ----------------------------------------------------------------------------

-- 1. Drop the blunt same-set-blocking exclusion constraint.
ALTER TABLE public.prayer_room_set_slots
  DROP CONSTRAINT IF EXISTS no_double_booking;

-- 2. Cross-set double-booking guard. occupied_range is kept current for every
--    filled slot by the existing trg_prss_range trigger, so we can compare the
--    incoming slot's computed range against other sets' stored ranges.
CREATE OR REPLACE FUNCTION public.prayer_room_block_cross_set_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s         record;
  new_range tstzrange;
BEGIN
  -- Only filled slots occupy a person's time.
  IF NEW.status <> 'filled' OR NEW.filled_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT set_date, start_time, end_time INTO s
    FROM public.prayer_room_sets WHERE id = NEW.set_id;

  -- SAST (Africa/Johannesburg) has no DST, so this conversion is unambiguous.
  new_range := tstzrange(
    (s.set_date + s.start_time) AT TIME ZONE 'Africa/Johannesburg',
    (s.set_date + s.end_time)   AT TIME ZONE 'Africa/Johannesburg',
    '[)');

  IF EXISTS (
    SELECT 1
      FROM public.prayer_room_set_slots x
     WHERE x.filled_user_id = NEW.filled_user_id
       AND x.status = 'filled'
       AND x.set_id <> NEW.set_id          -- same-set multi-role is now allowed
       AND x.id     <> NEW.id              -- never clash with self
       AND x.occupied_range && new_range   -- genuine time overlap
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = 'This clashes with someone already serving in another set at an overlapping time.';
  END IF;

  RETURN NEW;
END;
$$;

-- Name sorts after trg_prss_range so occupied_range is computed first.
DROP TRIGGER IF EXISTS trg_prss_xcross_check ON public.prayer_room_set_slots;
CREATE TRIGGER trg_prss_xcross_check
  BEFORE INSERT OR UPDATE ON public.prayer_room_set_slots
  FOR EACH ROW EXECUTE FUNCTION public.prayer_room_block_cross_set_overlap();
