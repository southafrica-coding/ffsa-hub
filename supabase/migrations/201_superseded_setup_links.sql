-- ============================================================
-- 201 — Tell "your link was replaced" apart from "you're already set up"
-- ============================================================
-- createOnboardingInvite supersedes a user's earlier open token by stamping
-- used_at on it — the same column that marks a token actually redeemed. The
-- setup page therefore reads a superseded link as "used" and tells the
-- person:
--
--     "Already set up. Head to the login page and sign in."
--
-- To someone who has never set anything up and has no password, that is both
-- false and a dead end: they land on login, can't sign in, and the page
-- offers them nothing. Anyone issued a second invite — every resend — hits
-- this if they click the older email.
--
-- Superseding gets its own column so the two states stay distinguishable.
-- ============================================================

ALTER TABLE public.onboarding_invites
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

COMMENT ON COLUMN public.onboarding_invites.superseded_at IS
  'Set when a newer invite replaced this one. Distinct from used_at, which '
  'means the person actually redeemed it and now has a password.';

-- Existing rows: a token stamped used_at while its user still has no
-- password was never really redeemed — it was superseded. Reclassify those
-- so the people already stuck on "Already set up" get the right message.
UPDATE public.onboarding_invites oi
SET superseded_at = oi.used_at,
    used_at = NULL
WHERE oi.used_at IS NOT NULL
  AND NOT public.user_has_password(oi.user_id);
