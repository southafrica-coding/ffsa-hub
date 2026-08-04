-- ============================================================
-- FFSA Hub — Migration 158: long-lived onboarding invite tokens
-- ============================================================
-- Accepted applicants used to receive a Supabase magic-link invite
-- whose token expires after (at most) 24h and is one-time-use — an
-- email security-scanner opening it, or a student who waits a day,
-- burns the link and lands on the login page with "invalid
-- credentials" (they never set a password, so no account appears to
-- exist).
--
-- This table backs an APP-CONTROLLED setup link instead. The token
-- lifetime is ours, not Supabase's, so it can live for 30 days. The
-- link (/setup/<token>) is validated server-side with the service-role
-- client and lets the applicant set their password once, then finish
-- onboarding. Single active token per user; single-use.
--
-- Read/written ONLY by the service-role admin client (accept-application,
-- resend-user-invite, and the /setup validation + /api/public/onboarding-setup
-- routes). RLS is enabled with NO policy so it is invisible to anon/auth
-- callers — the admin client bypasses RLS.
--
-- Idempotent: guarded CREATEs. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.onboarding_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_invites_token_idx
  ON public.onboarding_invites (token);
CREATE INDEX IF NOT EXISTS onboarding_invites_user_idx
  ON public.onboarding_invites (user_id);

COMMENT ON TABLE public.onboarding_invites IS
  'App-controlled onboarding setup tokens for accepted applicants / invited users. 30-day expiry, single-use, one active per user. Read/written only by the service-role admin client (RLS on, no policy).';

-- ────────────────────────────────────────────────────────────
-- RLS: enabled, deliberately NO policy. Only the service-role admin
-- client (which bypasses RLS) touches this table; anon/authenticated
-- callers can neither read tokens nor enumerate them.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.onboarding_invites ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- As the anon/auth role this must return NO rows (RLS blocks it):
--   SELECT count(*) FROM public.onboarding_invites;
--   -- As the service role (SQL editor) you can inspect live tokens:
--   SELECT user_id, email, expires_at, used_at FROM public.onboarding_invites
--     ORDER BY created_at DESC LIMIT 20;
-- ============================================================
