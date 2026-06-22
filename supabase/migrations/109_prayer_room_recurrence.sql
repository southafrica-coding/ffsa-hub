-- ============================================================================
-- 109 — Prayer Room: weekly recurring devo sets
-- ============================================================================
-- Mirrors the Space Bookings booking_series pattern: a series row holds the
-- weekly recurrence rule; each occurrence is a normal prayer_room_sets row
-- tagged with series_id. keep_team records the per-series choice from the
-- create dialog — whether each week is seeded with the same invited team or
-- with fresh open role slots.
-- ----------------------------------------------------------------------------

CREATE TABLE public.prayer_room_set_series (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid REFERENCES public.users(id),
  -- 0 = Sunday … 6 = Saturday (matches Postgres DOW and JS getDay()).
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  title        text,
  theme        text,
  series_start date NOT NULL,
  series_end   date NOT NULL,
  keep_team    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prs_series_end_after_start CHECK (end_time > start_time),
  CONSTRAINT prs_series_range_valid     CHECK (series_end >= series_start)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.prayer_room_set_series
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Tag occurrences with their series. ON DELETE SET NULL so deleting a series
-- leaves the already-created sets standing (buffer over delete).
ALTER TABLE public.prayer_room_sets
  ADD COLUMN series_id uuid REFERENCES public.prayer_room_set_series(id) ON DELETE SET NULL;
CREATE INDEX idx_prayer_room_sets_series ON public.prayer_room_sets(series_id);

-- RLS — mirrors prayer_room_sets: public read; owner (active member) or staff write.
ALTER TABLE public.prayer_room_set_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read series" ON public.prayer_room_set_series
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Create series" ON public.prayer_room_set_series
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_prayer_room_staff()
    OR (owner_id = auth.uid() AND public.is_prayer_room_member())
  );
CREATE POLICY "Update series" ON public.prayer_room_set_series
  FOR UPDATE TO authenticated
  USING (public.is_prayer_room_staff() OR owner_id = auth.uid())
  WITH CHECK (public.is_prayer_room_staff() OR owner_id = auth.uid());
CREATE POLICY "Delete series" ON public.prayer_room_set_series
  FOR DELETE TO authenticated
  USING (public.is_prayer_room_staff() OR owner_id = auth.uid());
