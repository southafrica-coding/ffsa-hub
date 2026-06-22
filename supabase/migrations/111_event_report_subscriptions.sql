-- ============================================================
-- FFSA Hub — Migration 111: Event report subscriptions
-- ============================================================
-- Lets an event organiser subscribe — per event — to recurring
-- ticketing-analytics digests, delivered by email and/or WhatsApp
-- on a daily or weekly cadence. Powers the new "Reports" tab in
-- the event detail view and the /api/cron/event-reports dispatcher.
--
-- Scoped to (event_id, user_id): each staff member who manages an
-- event keeps their own independent subscription. The dispatcher
-- cron reads/writes these rows via the service-role admin client
-- (bypasses RLS); the in-app UI reads/writes only the caller's own
-- row under the self-manage policies below — mirroring the
-- notification_preferences pattern from migration 069.
--
-- Append-only. Idempotent (IF NOT EXISTS everywhere). Apply by hand
-- in the Supabase SQL Editor, then regenerate src/types/database.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_report_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  enabled          boolean NOT NULL DEFAULT true,

  -- Delivery channels (at least one is enforced in the app layer)
  email_enabled    boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT false,

  -- Cadence
  cadence          text NOT NULL DEFAULT 'daily'
                     CHECK (cadence IN ('daily', 'weekly')),
  weekly_weekday   smallint NOT NULL DEFAULT 1       -- 0=Sun … 6=Sat, used when cadence='weekly'
                     CHECK (weekly_weekday BETWEEN 0 AND 6),
  send_hour_utc    smallint NOT NULL DEFAULT 6       -- 06:00 UTC = 08:00 SAST
                     CHECK (send_hour_utc BETWEEN 0 AND 23),

  -- Resolved destinations, snapshotted at save time so a later
  -- profile edit can't silently redirect a digest. Defaulted from
  -- users.email / users.phone in the API layer.
  dest_email       text,
  dest_whatsapp    text,                              -- E.164, validated app-side via src/lib/phone.ts

  -- Idempotency + last-run status (stamped by the dispatcher cron)
  last_sent_at       timestamptz,
  last_window_start  timestamptz,
  last_window_end    timestamptz,
  last_status        text CHECK (last_status IS NULL OR last_status IN
                       ('sent', 'partial', 'failed', 'skipped')),
  last_error         text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (event_id, user_id)
);

-- The dispatcher scans by send hour among enabled rows.
CREATE INDEX IF NOT EXISTS idx_event_report_subs_due
  ON public.event_report_subscriptions (send_hour_utc)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_event_report_subs_user
  ON public.event_report_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_event_report_subs_event
  ON public.event_report_subscriptions (event_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.event_report_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE public.event_report_subscriptions IS
  'Per-(event,user) subscription to recurring ticketing-analytics digests (email/WhatsApp, daily/weekly). Read/written by the in-app Reports tab (self-RLS) and the /api/cron/event-reports dispatcher (service role).';

-- ============================================================
-- RLS — self-manage only. Each user sees and edits their own
-- subscriptions. The cron uses createAdminClient() (service role),
-- which bypasses RLS, so no service-role policy is needed. The
-- "may this user subscribe at all" gate (must manage the event)
-- is enforced in the API route, not here.
-- ============================================================

ALTER TABLE public.event_report_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_report_subs_select_own ON public.event_report_subscriptions;
CREATE POLICY event_report_subs_select_own
  ON public.event_report_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS event_report_subs_insert_own ON public.event_report_subscriptions;
CREATE POLICY event_report_subs_insert_own
  ON public.event_report_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS event_report_subs_update_own ON public.event_report_subscriptions;
CREATE POLICY event_report_subs_update_own
  ON public.event_report_subscriptions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS event_report_subs_delete_own ON public.event_report_subscriptions;
CREATE POLICY event_report_subs_delete_own
  ON public.event_report_subscriptions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'event_report_subscriptions';   -- relrowsecurity = true
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'event_report_subscriptions'
--   ORDER BY ordinal_position;
-- ============================================================
