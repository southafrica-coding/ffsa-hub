-- ============================================================
-- 199 — Tell whether an auth account can actually be signed into
-- ============================================================
-- Accepted applicants get an auth user created WITHOUT a password
-- (accept-application sets email_confirm: true and mails a /setup link).
-- Nothing outside the auth schema could see that state, so every recovery
-- path guessed at it:
--
--   * resend-invite treated email_confirmed_at as "already activated" and
--     refused to resend — the exact opposite of the truth for this group;
--   * forgot-password asked Supabase for a recovery link, which is refused
--     for an unconfirmed address, and then returned its neutral response.
--
-- encrypted_password is the only honest signal, and it is not exposed by
-- the admin API. This SECURITY DEFINER function surfaces just the boolean,
-- never the hash, and only to the service role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, public
AS $$
  SELECT COALESCE(encrypted_password, '') <> ''
  FROM auth.users
  WHERE id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_has_password(uuid) IS
  'True when the auth user has a usable password. Service-role only: used by the '
  'onboarding/recovery routes to tell "never set up" apart from "forgot password".';

-- Service role only. This must never be reachable from the browser: it would
-- let anyone probe which addresses have accounts.
REVOKE ALL ON FUNCTION public.user_has_password(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_password(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_password(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_password(uuid) TO service_role;
