-- 344_users_color_scheme.sql
--
-- A personal Light / Dark setting for the Hub, saved on the person's own
-- users row so it follows them across devices.
--
--   users.color_scheme   'light' | 'dark' | NULL
--     NULL = never picked: the Hub follows the device (prefers-color-scheme)
--     and remembers that answer in a cookie on that device.
--
-- Who can change it
--   Only the person themself, through set_my_color_scheme(). Migration 315
--   locked public.users down to a column allowlist plus a guard trigger, and
--   this column is deliberately NOT added to that allowlist: a direct PATCH
--   of users.color_scheme by an authenticated session is refused (no column
--   grant). The function below is SECURITY DEFINER and only ever writes the
--   caller's own row (id = auth.uid()), so nobody, admins included, can set
--   someone else's theme through it. A deactivated account changes nothing,
--   matching 315.
--
-- Who can read it
--   Unchanged: whoever can already SELECT a users row (the person themself,
--   admins) sees the column. It carries nothing sensitive.
--
-- Idempotent: safe to run twice.

-- 1. Column ------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS color_scheme text;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_color_scheme_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_color_scheme_check
  CHECK (color_scheme IS NULL OR color_scheme IN ('light', 'dark'));

COMMENT ON COLUMN public.users.color_scheme IS
  '344: the person''s Hub theme, light or dark. NULL = follow the device. Written only by set_my_color_scheme().';

-- Belt and braces: 315 already revoked table-wide UPDATE, so no column grant
-- exists for this new column. Make that explicit so a later re-grant of the
-- 315 allowlist can't carry it along by accident.
REVOKE UPDATE (color_scheme) ON TABLE public.users FROM authenticated, anon;

-- 2. Setter ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_color_scheme(p_scheme text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to change your settings.' USING ERRCODE = '42501';
  END IF;

  IF p_scheme IS NOT NULL AND p_scheme NOT IN ('light', 'dark') THEN
    RAISE EXCEPTION 'Pick light or dark.' USING ERRCODE = '22023';
  END IF;

  SELECT u.is_active INTO v_active FROM public.users AS u WHERE u.id = v_uid;
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'This account is deactivated.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
     SET color_scheme = p_scheme
   WHERE id = v_uid;

  RETURN p_scheme;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_color_scheme(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_color_scheme(text) TO authenticated;

COMMENT ON FUNCTION public.set_my_color_scheme(text) IS
  '344: sets users.color_scheme (light, dark, or NULL to follow the device) on the caller''s own row only.';
