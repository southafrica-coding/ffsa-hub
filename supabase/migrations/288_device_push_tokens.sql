-- ────────────────────────────────────────────────────────────
-- 288 — Phone push notifications (Expo push)
-- ────────────────────────────────────────────────────────────
-- WHY: the FFSA Hub phone app (apps/mobile) can now receive push
-- notifications through the Expo push service (which wraps Apple APNs and
-- Google FCM). The server needs to know which phones belong to whom, and
-- people need to be able to switch push categories off.
--
--   1. device_push_tokens — one row per phone (Expo push token). Written
--      by POST /api/devices (sign-in / token change) and revoked by
--      DELETE /api/devices (sign-out) or when Expo reports the token as
--      DeviceNotRegistered (app uninstalled). Read by the server sender
--      (src/lib/push/send.ts) with the service role, like the Slack
--      broadcast sender. A user may see and manage ONLY their own rows.
--   2. notification_preferences.push_muted_kinds — per-user push category
--      opt-outs. The existing muted_modules column can't hold them: the
--      website's PUT /api/profile/notification-preferences rewrites the
--      whole array and drops keys it doesn't know, so it would silently
--      wipe push choices. Same row, same own-row RLS (069 / 187).
--
-- Push text is always generic ("A booking request is waiting for you"),
-- never names, amounts or other details (Apple guideline 4.5.4). Nothing
-- sensitive is stored here: an Expo push token, the platform, the app
-- version and an optional device name the phone reports.
--
-- Safe to run more than once. Until this is applied the API answers
-- POST /api/devices with 503 {"error":"push_not_enabled"} and the sender
-- does nothing, so the website and the app keep working without it.
-- ────────────────────────────────────────────────────────────

-- ── 1. device_push_tokens ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_token    text NOT NULL UNIQUE
    CHECK (char_length(expo_token) BETWEEN 10 AND 255),
  platform      text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version   text NOT NULL CHECK (char_length(app_version) <= 50),
  device_name   text NULL CHECK (device_name IS NULL OR char_length(device_name) <= 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz NULL
);

COMMENT ON TABLE public.device_push_tokens IS
  'Expo push tokens for the FFSA Hub phone app, one row per phone. revoked_at set on sign-out or when Expo reports DeviceNotRegistered. Written via /api/devices; read by the server push sender (service role).';

-- The sender's lookup: live tokens for a set of users.
CREATE INDEX IF NOT EXISTS device_push_tokens_user_live_idx
  ON public.device_push_tokens (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

-- Minimal grants: no anon access at all; signed-in users go through RLS.
REVOKE ALL ON public.device_push_tokens FROM anon;
REVOKE ALL ON public.device_push_tokens FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;

DROP POLICY IF EXISTS device_push_tokens_select_own ON public.device_push_tokens;
CREATE POLICY device_push_tokens_select_own
  ON public.device_push_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS device_push_tokens_insert_own ON public.device_push_tokens;
CREATE POLICY device_push_tokens_insert_own
  ON public.device_push_tokens FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS device_push_tokens_update_own ON public.device_push_tokens;
CREATE POLICY device_push_tokens_update_own
  ON public.device_push_tokens FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS device_push_tokens_delete_own ON public.device_push_tokens;
CREATE POLICY device_push_tokens_delete_own
  ON public.device_push_tokens FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── 2. Push category opt-outs ───────────────────────────────

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_muted_kinds text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.notification_preferences.push_muted_kinds IS
  'Phone push categories this user switched off (e.g. {booking_requests}). Keys come from PUSH_CATEGORIES in src/lib/push/categories.ts. Empty = receive every category. Absent row = same as empty.';

-- ============================================================
-- Verify:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'device_push_tokens';
--   -- true
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'device_push_tokens';
--   -- four rows: select / insert / update / delete, all own-row
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'notification_preferences' AND column_name = 'push_muted_kinds';
--   -- one row
-- ============================================================
