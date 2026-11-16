-- ============================================================================
-- 234 — Vehicles: Slack DM alerts for the vehicle coordinator
-- ============================================================================
-- The coordinator gets a Slack DM through the rental lifecycle — alongside the
-- existing manager emails, not instead of them:
--   • a new request, with Assign vehicle / Approve / Deny right in the DM
--   • signed out, signed in (with Mark completed), payment received,
--     agreement signed, cancelled
--   • a 07:00 SAST summary of today's pickups / returns, overdue returns,
--     unpaid upcoming pickups and requests waiting on a decision.
--
--   • vehicle_alert_settings.slack_alert_user_ids — who gets them. Seeded
--     with the vehicle coordinator.
--   • vehicle_booking_slack_alerts — every DM posted that may need rewriting
--     later (the request once it's decided, a sign-in once it's completed).
--     Server-only: RLS on, no policies.
--
-- Already applied in production, including the original coordinator row.
-- The name and id in the seed below are placeholders. This edit is a
-- text-only scrub: do not re-apply this file from the SQL editor.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vehicle_alert_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  slack_alert_user_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.vehicle_alert_settings (id, slack_alert_user_ids)
VALUES (true, ARRAY['00000000-0000-4000-8000-000000000924'::uuid]) -- vehicle coordinator (placeholder)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vehicle_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.vehicle_booking_slack_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_booking_id uuid NOT NULL REFERENCES public.vehicle_bookings (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('request', 'returned')),
  recipient_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  slack_channel     text NOT NULL,
  slack_ts          text NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  UNIQUE (vehicle_booking_id, kind, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_booking_slack_alerts_booking
  ON public.vehicle_booking_slack_alerts (vehicle_booking_id);

ALTER TABLE public.vehicle_booking_slack_alerts ENABLE ROW LEVEL SECURITY;
