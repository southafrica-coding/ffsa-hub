-- ============================================================
-- 203 — Which accounts have never had a password, in one query
-- ============================================================
-- user_has_password (migration 199) answers for one user at a time, which is
-- fine for a recovery route handling a single request and useless for the
-- Users page: asking it per row would mean hundreds of round trips to render
-- one table.
--
-- Without it the admin list cannot show the state that matters most — an
-- account created at acceptance that the person never finished setting up.
-- Not seeing it is why the fix looked like deleting the user and starting
-- over, which unlinks their application (migration 200). Showing it turns
-- that into "copy them a fresh link".
--
-- Returns ids only: no emails, no hashes, nothing that widens what the admin
-- client can already read from public.users.
-- ============================================================

CREATE OR REPLACE FUNCTION public.users_without_password()
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, public
AS $$
  SELECT u.id
  FROM public.users u
  LEFT JOIN auth.users au ON au.id = u.id
  -- No auth row at all counts as "no password": the person cannot sign in
  -- either way, and a public.users row without its auth twin is exactly the
  -- half-made state an admin needs to see rather than guess at.
  WHERE COALESCE(au.encrypted_password, '') = '';
$$;

COMMENT ON FUNCTION public.users_without_password() IS
  'Ids of users who cannot sign in with a password (never set one, or no auth row). '
  'Service-role only: powers the account-state column on the admin Users page.';

REVOKE ALL ON FUNCTION public.users_without_password() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.users_without_password() FROM anon;
REVOKE ALL ON FUNCTION public.users_without_password() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.users_without_password() TO service_role;
