-- ============================================================
-- 204 — Decide and record a throttle slot in one atomic step
-- ============================================================
-- Migration 202 moved the forgot-password throttle onto the address so the
-- route could report it honestly. The route did that in three trips: read the
-- recent history, decide, then insert. Two requests arriving within the same
-- few milliseconds both completed the read before either insert was visible,
-- so both were allowed and two links went out. It takes a double-click to hit
-- — a person retrying seconds later is throttled correctly — but "we decided
-- based on a snapshot someone else was already invalidating" is a race, and
-- the whole point of 202 was that this answer can be trusted.
--
-- Doing it in one statement removes the window. The advisory lock is taken on
-- the address, so concurrent requests for the SAME address queue behind each
-- other while requests for different addresses never contend. It is a
-- transaction-scoped lock: it releases on commit, with no unlock to leak.
--
-- Only an allowed request inserts. That matters — if every attempt were
-- recorded, a handful of impatient double-clicks would burn the hourly cap and
-- lock someone out for an hour having received one email. The cap counts
-- links actually sent, which is what it always meant.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_password_reset_slot(
  p_email            text,
  p_min_gap_seconds  int,
  p_hourly_cap       int
)
RETURNS TABLE (allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  int;
  v_oldest timestamptz;
  v_last   timestamptz;
  v_wait   double precision;
BEGIN
  -- Serialize callers for this address only. Anything else runs unimpeded.
  PERFORM pg_advisory_xact_lock(hashtext('password_reset_slot:' || p_email));

  SELECT count(*), min(created_at), max(created_at)
    INTO v_count, v_oldest, v_last
  FROM public.password_reset_requests
  WHERE email_normalized = p_email
    AND created_at > now() - interval '1 hour';

  -- Hourly cap: free again one hour after the OLDEST request in the window.
  IF v_count >= p_hourly_cap THEN
    v_wait := EXTRACT(EPOCH FROM (v_oldest + interval '1 hour' - now()));
    RETURN QUERY SELECT false, GREATEST(1, CEIL(v_wait))::int;
    RETURN;
  END IF;

  -- Minimum gap since the last one we actually sent.
  IF v_last IS NOT NULL THEN
    v_wait := p_min_gap_seconds - EXTRACT(EPOCH FROM (now() - v_last));
    IF v_wait > 0 THEN
      RETURN QUERY SELECT false, GREATEST(1, CEIL(v_wait))::int;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.password_reset_requests (email_normalized) VALUES (p_email);

  RETURN QUERY SELECT true, 0;
END;
$$;

COMMENT ON FUNCTION public.claim_password_reset_slot(text, int, int) IS
  'Atomically decides whether a forgot-password/setup-link email may be sent for '
  'an address and records it if so. Returns (allowed, retry_after_seconds). '
  'Service-role only: it is a throttle oracle, not a public endpoint.';

REVOKE ALL ON FUNCTION public.claim_password_reset_slot(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_password_reset_slot(text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.claim_password_reset_slot(text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_password_reset_slot(text, int, int) TO service_role;
