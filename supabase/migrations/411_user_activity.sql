-- ============================================================
-- FFSA Hub — Migration 411: daily user activity (DAU / WAU)
-- ============================================================
-- The Hub has no usage data. The only trace of a visit is Supabase Auth's
-- last_sign_in_at, which moves on sign-in, not on use (a session lasts weeks),
-- and audit_logs, which records writes only. Neither can answer "how many
-- people used the Hub today / this week?".
--
-- This adds user_activity: at most one row per user, per day, per platform,
-- written by record_user_activity() the first time the user's browser (or the
-- phone app) is seen that day. It stores WHO was active and WHEN, nothing
-- about WHAT they looked at: no URL, no page, no IP, no user agent.
--
-- DAY BOUNDARY. A day is a calendar day in Africa/Johannesburg (the ministry's
-- working day), not UTC, so a 00:30 SAST visit counts for the new day.
--
-- WRITES go through record_user_activity() only (SECURITY DEFINER, uses
-- auth.uid(), so a caller can only ever record themselves). There are no
-- INSERT / UPDATE / DELETE policies on the table.
--
-- READS are admin-only (is_admin(), same as audit_logs). The views are
-- security_invoker, so they inherit that: a non-admin sees zero rows.
--
-- Not applied automatically: run in the Supabase SQL editor (see README).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABLE
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_activity (
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day           date        NOT NULL,
  platform      text        NOT NULL DEFAULT 'web',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- How many times the user was recorded that day. The recorder throttles to
  -- about once per browser per day, so this is "check-ins", not page views.
  hits          integer     NOT NULL DEFAULT 1,

  PRIMARY KEY (user_id, day, platform),
  CONSTRAINT user_activity_platform_ck CHECK (platform IN ('web', 'mobile'))
);

CREATE INDEX IF NOT EXISTS idx_user_activity_day ON public.user_activity (day);

COMMENT ON TABLE public.user_activity IS
  'One row per user per Johannesburg calendar day per platform. Who was active and when; never what they viewed.';

-- ────────────────────────────────────────────────────────────
-- 2. RLS — admin read, no direct writes
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read user activity"
  ON public.user_activity FOR SELECT
  USING (public.is_admin());

REVOKE ALL ON public.user_activity FROM anon, authenticated;
GRANT SELECT ON public.user_activity TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. RECORDER
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_user_activity(p_platform text DEFAULT 'web')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_platform text := CASE WHEN p_platform = 'mobile' THEN 'mobile' ELSE 'web' END;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_activity (user_id, day, platform)
  VALUES (v_uid, (now() AT TIME ZONE 'Africa/Johannesburg')::date, v_platform)
  ON CONFLICT (user_id, day, platform) DO UPDATE
    SET last_seen_at = now(),
        hits = public.user_activity.hits + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_user_activity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_activity(text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. DAU / WAU VIEWS (admin-readable via the table's RLS)
-- ────────────────────────────────────────────────────────────
-- One row per day from the first recorded day to today, zero-filled.
--   daily_active_users.active_users  = distinct users seen that day
--   weekly_active_users.active_users = distinct users seen in the 7 days
--                                      ending that day (rolling, inclusive)
-- Today's row is partial until the day ends.

CREATE OR REPLACE VIEW public.daily_active_users
WITH (security_invoker = true) AS
SELECT
  d.day,
  count(DISTINCT ua.user_id)                                  AS active_users,
  count(DISTINCT ua.user_id) FILTER (WHERE ua.platform = 'web')    AS web_users,
  count(DISTINCT ua.user_id) FILTER (WHERE ua.platform = 'mobile') AS mobile_users
FROM (
  SELECT g::date AS day
  FROM generate_series(
    (SELECT min(day) FROM public.user_activity),
    (now() AT TIME ZONE 'Africa/Johannesburg')::date,
    interval '1 day'
  ) AS g
) d
LEFT JOIN public.user_activity ua ON ua.day = d.day
GROUP BY d.day
ORDER BY d.day DESC;

CREATE OR REPLACE VIEW public.weekly_active_users
WITH (security_invoker = true) AS
SELECT
  d.day,
  count(DISTINCT ua.user_id) AS active_users
FROM (
  SELECT g::date AS day
  FROM generate_series(
    (SELECT min(day) FROM public.user_activity),
    (now() AT TIME ZONE 'Africa/Johannesburg')::date,
    interval '1 day'
  ) AS g
) d
LEFT JOIN public.user_activity ua ON ua.day BETWEEN d.day - 6 AND d.day
GROUP BY d.day
ORDER BY d.day DESC;

REVOKE ALL ON public.daily_active_users, public.weekly_active_users FROM anon, authenticated;
GRANT SELECT ON public.daily_active_users, public.weekly_active_users TO authenticated;

COMMENT ON VIEW public.daily_active_users IS
  'Distinct active users per Johannesburg day (web / mobile split). Admin-only via user_activity RLS.';
COMMENT ON VIEW public.weekly_active_users IS
  'Distinct active users in the 7 days ending each day (rolling WAU). Admin-only via user_activity RLS.';
