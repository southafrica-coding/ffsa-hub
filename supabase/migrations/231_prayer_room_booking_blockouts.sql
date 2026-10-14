-- ============================================================================
-- 231 — Prayer Room: block-outs suggested by Space Bookings
-- ============================================================================
-- When the prayer room's venue (the Auditorium) is booked in Space Bookings
-- over a scheduled devo set, the prayer-room Manage tab now suggests a
-- block-out pre-filled from that booking. The suggestions themselves are
-- DERIVED on read (approved bookings × scheduled sets × existing block-outs),
-- so a cancelled or moved booking updates them with no extra bookkeeping.
-- Only two facts need storing:
--
--   • which booking a block-out was applied from, and the booking's slot at
--     that moment — so a later change to the booking can be flagged on the
--     block-out instead of silently drifting;
--   • which suggestions a manager dismissed, keyed by the booking's slot, so a
--     dismissed booking stays quiet unless its date / time changes.
--
-- Idempotent (IF NOT EXISTS) so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

-- 1) Provenance on block-outs. ON DELETE SET NULL: a hard-deleted booking
--    leaves the block-out in place (the manager decides whether to remove it).
ALTER TABLE public.prayer_room_blockouts
  ADD COLUMN IF NOT EXISTS source_booking_id uuid
    REFERENCES public.venue_bookings (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_signature text;

CREATE INDEX IF NOT EXISTS idx_prayer_room_blockouts_source_booking
  ON public.prayer_room_blockouts (source_booking_id)
  WHERE source_booking_id IS NOT NULL;

-- 2) Dismissed suggestions — one row per booking occurrence.
CREATE TABLE IF NOT EXISTS public.prayer_room_booking_dismissals (
  booking_id   uuid PRIMARY KEY REFERENCES public.venue_bookings (id) ON DELETE CASCADE,
  signature    text NOT NULL,
  dismissed_by uuid REFERENCES public.users (id),
  dismissed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prayer_room_booking_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage booking dismissals" ON public.prayer_room_booking_dismissals;
CREATE POLICY "Staff manage booking dismissals" ON public.prayer_room_booking_dismissals
  FOR ALL TO authenticated
  USING (public.is_prayer_room_staff())
  WITH CHECK (public.is_prayer_room_staff());
