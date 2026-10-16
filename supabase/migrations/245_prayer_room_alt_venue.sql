-- ────────────────────────────────────────────────────────────
-- 245 — Devo sets: alternate space
--
-- When a devo set can't run in the prayer room, the person booking it can
-- pick an alternate space (the Music Room first). The set then books that
-- space in Space Bookings, titled with the set's title, so the space shows
-- as taken there.
--
--   venues                       — a "Music Room" space, if there isn't one
--                                   already (it may have been added by hand
--                                   under a different slug).
--   prayer_room_sets.alt_venue_id   — the space the set moved to.
--   prayer_room_sets.alt_booking_id — the Space Bookings row it holds there,
--                                      kept in step when the set is retimed,
--                                      renamed, cancelled or deleted.
--
-- Bookings are written by the server (service role) — set owners don't need
-- a bookings.* permission to hold the space for their own set.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.venues (name, slug, building, color, sort_order)
SELECT 'Music Room', 'music-room', 'Base', '#3E7F2B', 15
WHERE NOT EXISTS (
  SELECT 1 FROM public.venues WHERE slug = 'music-room' OR name ILIKE 'music room%'
);

ALTER TABLE public.prayer_room_sets
  ADD COLUMN IF NOT EXISTS alt_venue_id   uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alt_booking_id uuid REFERENCES public.venue_bookings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prayer_room_sets_alt_booking
  ON public.prayer_room_sets (alt_booking_id) WHERE alt_booking_id IS NOT NULL;

-- ============================================================
-- Validation
--   SELECT id, name, slug FROM public.venues WHERE slug = 'music-room' OR name ILIKE 'music room%';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'prayer_room_sets' AND column_name LIKE 'alt_%';
-- ============================================================
