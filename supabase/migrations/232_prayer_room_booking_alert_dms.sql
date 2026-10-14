-- ============================================================================
-- 232 — Prayer Room: Slack DM alerts for Auditorium bookings over devo sets
-- ============================================================================
-- When a Space Booking of the prayer room displaces devo sets (the suggestions
-- from 231), the chosen prayer-room managers each get a Slack DM with a
-- "move sets to" dropdown and a one-click "Block out & notify". Whoever acts
-- first handles it; every recipient's DM is then rewritten to say so.
--
--   • prayer_room_settings.booking_alert_user_ids — who gets the DMs
--     (editable in Manage → Block-out). Seeded with Jack Kilman + Jolizna
--     Roestorf.
--   • prayer_room_booking_alerts — one row per (alert, recipient) DM, holding
--     the Slack channel + ts so the message can be updated later. Server-only
--     (no RLS policies → only the service role reads/writes it).
--
-- Idempotent so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

ALTER TABLE public.prayer_room_settings
  ADD COLUMN IF NOT EXISTS booking_alert_user_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE public.prayer_room_settings
  SET booking_alert_user_ids = ARRAY[
    '26d4b510-0779-41bc-977d-4b2796fe4852'::uuid, -- Jack Kilman
    'c57ec7f7-551b-479f-84b1-a458af66d40a'::uuid  -- Jolizna Roestorf
  ]
  WHERE booking_alert_user_ids = '{}';

CREATE TABLE IF NOT EXISTS public.prayer_room_booking_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "<suggestion key>|<slot fingerprint>": a moved booking is a new alert.
  alert_key         text NOT NULL,
  suggestion_key    text NOT NULL,
  title             text NOT NULL DEFAULT '',
  recipient_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  slack_channel     text NOT NULL,
  slack_ts          text NOT NULL,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved')),
  resolution        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  UNIQUE (alert_key, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_prayer_room_booking_alerts_open
  ON public.prayer_room_booking_alerts (status) WHERE status = 'open';

ALTER TABLE public.prayer_room_booking_alerts ENABLE ROW LEVEL SECURITY;
