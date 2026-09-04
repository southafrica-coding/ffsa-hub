-- ============================================================
-- 202 — Throttle password/setup link requests by email, not by account
-- ============================================================
-- forgot-password rate-limits from audit_logs rows keyed on users.id, which
-- means the throttle only exists once an account has been resolved. Two
-- consequences, both bad:
--
--   * The response could never mention the throttle. Naming it would have
--     revealed that an account exists for that address, so the route returned
--     its cheerful neutral "Link sent" instead — while sending nothing. Anyone
--     helping an applicant in real time ("try it again now") hits the 60s gap
--     on the second attempt and is told it worked. That is the dead end
--     migrations 199 and 201 were each written to close, still open one level
--     up: the right email was chosen and then never sent.
--
--   * Requests for addresses with no account were not counted at all, so the
--     hourly cap protected only the people who already had accounts.
--
-- Counting every request against the normalized email fixes both. The throttle
-- now applies identically whether or not an account exists, so the route can
-- say "you asked a moment ago, try again in N seconds" to everyone without
-- leaking anything: the answer depends only on what this address has just
-- done, never on whether it is registered.
--
-- Kept deliberately thin — an append-only log of (email, when). No user_id: it
-- must work before an account is resolved, and it must not become another
-- place personal data accumulates. Old rows are prunable at any time; only the
-- last hour is ever read.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The only query this table serves: "requests for this address in the last
-- hour, newest first" — both the hourly cap and the minimum gap read it.
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_email_time
  ON public.password_reset_requests (email_normalized, created_at DESC);

COMMENT ON TABLE public.password_reset_requests IS
  'Append-only throttle log for forgot-password / setup-link requests, keyed by '
  'normalized email so the limit applies before an account is resolved. Read for '
  'the last hour only; safe to prune.';

-- Service-role only. RLS on with no policy: anon and authenticated get nothing,
-- which is the point — a readable throttle log is an account-enumeration oracle.
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.password_reset_requests FROM PUBLIC;
REVOKE ALL ON public.password_reset_requests FROM anon;
REVOKE ALL ON public.password_reset_requests FROM authenticated;
GRANT SELECT, INSERT ON public.password_reset_requests TO service_role;
