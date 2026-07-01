-- ============================================================================
-- 117 — Prayer Room: whole-day & multi-day (week) block-outs
-- ============================================================================
-- Extends the single-date, time-window block-out (110) so a manager can block
-- out a whole day, a whole week, or any multi-day range:
--   • end_date        — the block-out now spans block_date → end_date (a single
--                        day keeps end_date = block_date).
--   • NULL start/end  — a NULL time window means "all day": the room is out for
--                        every devo set on the covered date(s), not just a slice.
--
-- A timed block-out (start_time + end_time present) stays single-day, exactly as
-- before. Existing rows are backfilled to end_date = block_date, unchanged.
-- ----------------------------------------------------------------------------

-- 1) Span end. Column DEFAULTs can't reference another column, so add nullable,
--    backfill from block_date, then enforce NOT NULL.
ALTER TABLE public.prayer_room_blockouts
  ADD COLUMN end_date date;

UPDATE public.prayer_room_blockouts
  SET end_date = block_date
  WHERE end_date IS NULL;

ALTER TABLE public.prayer_room_blockouts
  ALTER COLUMN end_date SET NOT NULL;

-- 2) All-day = NULL times. Existing timed rows keep their times untouched.
ALTER TABLE public.prayer_room_blockouts
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time   DROP NOT NULL;

-- 3) Re-state the integrity rules: valid span, and times either both absent
--    (all-day) or a proper window.
ALTER TABLE public.prayer_room_blockouts
  DROP CONSTRAINT IF EXISTS blockout_end_after_start;

ALTER TABLE public.prayer_room_blockouts
  ADD CONSTRAINT blockout_dates_ordered CHECK (end_date >= block_date),
  ADD CONSTRAINT blockout_times_valid CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );

-- 4) end_date is the field range/overlap queries filter on, so index it too.
CREATE INDEX idx_prayer_room_blockouts_end_date ON public.prayer_room_blockouts(end_date);
