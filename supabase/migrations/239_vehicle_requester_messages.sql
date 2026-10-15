-- ============================================================================
-- 239 — Vehicles: what the requester was told, and how
-- ============================================================================
-- Every confirmation / update the person who booked receives now goes to them
-- directly as a Slack DM (plus email), and a vehicle manager can write them a
-- message from the booking page. This is the log of all of it, shown on the
-- booking so the coordinator can see exactly what was sent:
--
--   kind     — 'message' (typed by a manager) or the lifecycle event
--              (submitted / approved / denied / reopened / changed /
--               cancelled / completed)
--   body     — the message, or the change summary
--   via_slack / via_email — which channels actually delivered
--
-- Server-only: RLS on, no policies (read + written with the admin client
-- after the route has checked access).
--
-- Idempotent so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vehicle_booking_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN (
                       'message', 'submitted', 'approved', 'denied', 'reopened',
                       'changed', 'cancelled', 'completed'
                     )),
  body               text,
  sent_by            uuid REFERENCES public.users (id) ON DELETE SET NULL,
  via_slack          boolean NOT NULL DEFAULT false,
  via_email          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_booking_messages_booking_idx
  ON public.vehicle_booking_messages (vehicle_booking_id, created_at DESC);

ALTER TABLE public.vehicle_booking_messages ENABLE ROW LEVEL SECURITY;
