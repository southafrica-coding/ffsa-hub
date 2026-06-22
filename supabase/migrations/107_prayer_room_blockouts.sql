-- ============================================================================
-- 107 — Prayer Room: block-out dates (replaces the templates concept)
-- ============================================================================
-- A block-out marks a window when the prayer room is needed for another event,
-- so the devo sets that fall in it move elsewhere. Creating a block-out stamps
-- a free-text relocation note on every overlapping scheduled set and posts a
-- heads-up to the dedicated prayer-room Slack channel (handled in the route).
--
-- The old prayer_room_template_blocks table + ensure_prayer_room_week() are
-- left in place but no longer surfaced in the UI — weekly recurrence (106) is
-- now how repeating sets are created.
-- ----------------------------------------------------------------------------

CREATE TABLE public.prayer_room_blockouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date      date NOT NULL,
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  reason          text,
  relocation_note text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blockout_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX idx_prayer_room_blockouts_date ON public.prayer_room_blockouts(block_date);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.prayer_room_blockouts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Free-text "where it moved to", stamped on sets a block-out displaces.
ALTER TABLE public.prayer_room_sets
  ADD COLUMN relocation_note text;

-- RLS — public read (the schedule shows relocations); staff manage.
ALTER TABLE public.prayer_room_blockouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read blockouts" ON public.prayer_room_blockouts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff manage blockouts" ON public.prayer_room_blockouts
  FOR ALL TO authenticated
  USING (public.is_prayer_room_staff())
  WITH CHECK (public.is_prayer_room_staff());
