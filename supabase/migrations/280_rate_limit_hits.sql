-- ============================================================
-- FFSA Hub — Migration 280: "shared rate limiting"
-- ============================================================
-- Safe to run twice: the table and index are IF NOT EXISTS, the function is
-- CREATE OR REPLACE, and the grants/revokes simply restate the same state.
--
-- WHY: the public door scanner (/api/scan/[token]) limited requests with an
-- in-memory counter. On Vercel every warm server instance has its own memory,
-- so a leaked door link hammered from one place was spread across many
-- counters and was barely limited. This moves the counter into Postgres, where
-- every instance shares it. The anonymous photo-upload signer
-- (/api/upload/sign) uses it too.
--
-- WHAT IT ADDS:
--   * public.rate_limit_hits: one row per (key, time window) holding a count.
--     Keys arrive SHA-256 hashed from the app, so no door token or IP address
--     is stored in readable form.
--   * public.rate_limit_hit(p_key, p_limit, p_window_seconds): counts one hit
--     atomically (INSERT ... ON CONFLICT DO UPDATE, so two requests at the
--     same instant can't both slip through) and says whether it is allowed.
--     Windows are fixed and aligned to the clock (a 60-second window resets on
--     the minute). About one call in a hundred also deletes rows older than
--     two days, so the table stays small without a cron job.
--
-- WHO CAN USE IT: only the server. RLS is enabled with NO policies, and
-- EXECUTE on the function is revoked from public / anon / authenticated and
-- granted to service_role only. A signed-in user (or the phone app) calling
-- it directly gets "permission denied".
--
-- ORDER: code and migration can ship in either order. Until this is applied,
-- the app logs "[rate-limit] shared limiter unavailable" once per server
-- instance and falls back to the old per-instance memory counter. It never
-- blocks a request because the limiter is missing.
--
-- ROLLBACK (nothing else depends on these; the app falls back to memory):
--   DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, integer);
--   DROP TABLE IF EXISTS public.rate_limit_hits;
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- For the opportunistic cleanup below.
CREATE INDEX IF NOT EXISTS rate_limit_hits_window_start_idx
  ON public.rate_limit_hits (window_start);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only service_role (which bypasses RLS) touches it.

REVOKE ALL ON TABLE public.rate_limit_hits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_hits TO service_role;


-- ────────────────────────────────────────────────────────────
-- 2. Count one hit
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 256 THEN
    RAISE EXCEPTION 'rate_limit_hit: key must be 1-256 characters';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: limit must be at least 1';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'rate_limit_hit: window must be 1-86400 seconds';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_hits AS h (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
    DO UPDATE SET count = h.count + 1
  RETURNING h.count INTO v_count;

  -- Opportunistic cleanup. Windows are at most a day, so anything older than
  -- two days is finished with.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_hits
    WHERE window_start < now() - interval '2 days';
  END IF;

  RETURN QUERY SELECT
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer)
  TO service_role;


-- ============================================================
-- Verify:
--   -- 1. RLS on, no policies:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'rate_limit_hits';  -- true
--   SELECT count(*) FROM pg_policies WHERE tablename = 'rate_limit_hits';  -- 0
--
--   -- 2. Only service_role may call it (anon/authenticated: false):
--   SELECT r AS role, has_function_privilege(r, 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE')
--   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r;
--
--   -- 3. It counts (run as the SQL editor's postgres role; 3 calls, limit 2;
--   --    if the clock passes a whole minute between calls the count restarts):
--   SELECT * FROM public.rate_limit_hit('verify-280', 2, 60);  -- allowed t, remaining 1
--   SELECT * FROM public.rate_limit_hit('verify-280', 2, 60);  -- allowed t, remaining 0
--   SELECT * FROM public.rate_limit_hit('verify-280', 2, 60);  -- allowed f, remaining 0
--   DELETE FROM public.rate_limit_hits WHERE key = 'verify-280';
-- ============================================================
