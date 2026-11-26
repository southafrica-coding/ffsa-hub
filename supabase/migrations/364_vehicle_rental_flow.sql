-- ============================================================
-- FFSA Hub — Migration 364: vehicle bookings — pick-up and return messages,
-- Returned, post-rental inspection, Return early, driver emails
-- ============================================================
-- Requires 103, 234, 239, 240. Independent of the Fleet migrations 357–359.
--
-- Gideon, 24 Nov 2026: one standard message flow for every vehicle booking.
--   • Pick-up day: the person who booked (point person) and every driver get
--     instructions. Drivers now have an email on the booking, so drivers who
--     aren't on the Hub can be emailed too.
--   • 07:00 the day before the vehicle is due back: a reminder, with Return early.
--   • 07:00 the day it's due back: the return instructions, and the coordinator
--     gets a Slack message with a Returned button.
--   • After Returned: a post-rental inspection message; the booking is completed
--     once Fleet's post-rental inspection is recorded.
--
-- return_date stays "the day it's due back". The forms now ask for the last day
-- the vehicle is needed and the Hub adds a day, so every clash and availability
-- check already blocks the due-back day; no function changes here.
--
-- Safe to re-run, one transaction; no anon or PUBLIC grants.
-- ============================================================

BEGIN;

-- ── Bookings: returned, and Return early ──────────────────────
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS returned_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by                 uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS early_return_date           date,
  ADD COLUMN IF NOT EXISTS early_return_status         text,
  ADD COLUMN IF NOT EXISTS early_return_requested_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS early_return_requested_at   timestamptz;

ALTER TABLE public.vehicle_bookings DROP CONSTRAINT IF EXISTS vehicle_bookings_early_return_status_check;
ALTER TABLE public.vehicle_bookings ADD CONSTRAINT vehicle_bookings_early_return_status_check
  CHECK (early_return_status IS NULL OR early_return_status IN ('requested', 'approved', 'declined'));

-- The person who booked can update their own booking (103), so these are guarded:
-- only vehicle managers (or the server, as service role) mark a vehicle returned or
-- decide an early return. A requester may only ASK (status 'requested'). Nobody
-- approves their own early return, not even a manager: not the person who booked,
-- nor the person who asked (Jack's review of #712).
CREATE OR REPLACE FUNCTION public.vehicle_bookings_guard_return()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.early_return_status = 'approved'
     AND OLD.early_return_status IS DISTINCT FROM 'approved'
     AND auth.uid() IN (NEW.requested_by, NEW.early_return_requested_by) THEN
    RAISE EXCEPTION 'You can''t approve your own early return' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL
     OR public.is_admin()
     OR public.has_permission('vehicles.approve')
     OR public.has_permission('vehicles.manage') THEN
    RETURN NEW;
  END IF;
  IF NEW.returned_at IS DISTINCT FROM OLD.returned_at
     OR NEW.returned_by IS DISTINCT FROM OLD.returned_by THEN
    RAISE EXCEPTION 'Only the Vehicle Coordinator can mark a vehicle returned' USING ERRCODE = '42501';
  END IF;
  IF NEW.early_return_status IS DISTINCT FROM OLD.early_return_status
     AND NEW.early_return_status IS DISTINCT FROM 'requested' THEN
    RAISE EXCEPTION 'Only the Vehicle Coordinator can decide an early return' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_bookings_guard_return ON public.vehicle_bookings;
CREATE TRIGGER vehicle_bookings_guard_return
  BEFORE UPDATE ON public.vehicle_bookings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_bookings_guard_return();

-- ── Drivers: an email, so drivers not on the Hub get their instructions ──
ALTER TABLE public.vehicle_booking_drivers ADD COLUMN IF NOT EXISTS email text;

-- ── What the requester was told: the new message kinds (239) ──
ALTER TABLE public.vehicle_booking_messages ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE public.vehicle_booking_messages DROP CONSTRAINT IF EXISTS vehicle_booking_messages_kind_check;
ALTER TABLE public.vehicle_booking_messages ADD CONSTRAINT vehicle_booking_messages_kind_check
  CHECK (kind IN (
    'message', 'submitted', 'approved', 'denied', 'reopened', 'changed', 'cancelled', 'completed',
    'pickup-point', 'pickup-driver', 'return-before', 'return-day', 'early-return'
  ));

-- ── The coordinator's Slack messages that get updated in place (234) ──
ALTER TABLE public.vehicle_booking_slack_alerts DROP CONSTRAINT IF EXISTS vehicle_booking_slack_alerts_kind_check;
ALTER TABLE public.vehicle_booking_slack_alerts ADD CONSTRAINT vehicle_booking_slack_alerts_kind_check
  CHECK (kind IN ('request', 'returned', 'due-back', 'post-rental', 'early-return'));

-- ── Each scheduled message once per person: the scheduler claims a row first ──
CREATE TABLE IF NOT EXISTS public.vehicle_rental_sends (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('pickup-point', 'pickup-driver', 'return-before', 'return-day', 'due-back')),
  recipient          text NOT NULL,   -- user id, or lower-cased email
  for_date           date NOT NULL,   -- the pick-up or due-back day it was about
  via_slack          boolean NOT NULL DEFAULT false,
  via_email          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_booking_id, kind, recipient, for_date)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_rental_sends_booking ON public.vehicle_rental_sends (vehicle_booking_id);

-- Written and read by the server only (service role); nothing for authenticated or anon.
ALTER TABLE public.vehicle_rental_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_rental_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.vehicle_rental_sends TO service_role;

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'vehicle_bookings' AND column_name LIKE ANY (ARRAY['returned%', 'early_return%']);
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('vehicle_booking_messages_kind_check', 'vehicle_booking_slack_alerts_kind_check');
--   SELECT * FROM public.vehicle_rental_sends ORDER BY created_at DESC LIMIT 20;
