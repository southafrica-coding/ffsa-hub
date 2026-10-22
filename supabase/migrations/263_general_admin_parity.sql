-- 263 — General Admin = Super Admin, minus the Records Library
--
-- Ruling (2026-10-22): `admin` (General Admin) has every power a
-- `super_admin` has. The ONLY difference is the Records Library — so an
-- admin cannot open it, and cannot hand out the two things that would open
-- it: the super_admin role and the records_library.manage permission.
--
-- The app layer was widened in the same PR (user management, roles,
-- permissions, Evangelism). Two database rules still said super_admin only:
--
--   1. user_permissions_write (migration 014): /api/admin/grant-permission
--      writes through the user's own client, so admins were refused by RLS.
--   2. can_access_expired_applications() (migration 223): applications of a
--      school 6+ months past its end were super_admin + Training Team only.
--
-- Safe to re-run.

-- ── 1. Direct permission grants ─────────────────────────────

DROP POLICY IF EXISTS "user_permissions_write" ON public.user_permissions;

CREATE POLICY "user_permissions_write" ON public.user_permissions
  FOR ALL TO authenticated
  USING (
    public.has_any_role(ARRAY['super_admin'])
    OR (
      public.has_any_role(ARRAY['admin'])
      AND NOT EXISTS (
        SELECT 1 FROM public.permissions p
        WHERE p.id = user_permissions.permission_id
          AND p.key = 'records_library.manage'
      )
    )
  )
  WITH CHECK (
    public.has_any_role(ARRAY['super_admin'])
    OR (
      public.has_any_role(ARRAY['admin'])
      AND NOT EXISTS (
        SELECT 1 FROM public.permissions p
        WHERE p.id = user_permissions.permission_id
          AND p.key = 'records_library.manage'
      )
    )
  );

-- ── 2. Expired school applications ──────────────────────────

CREATE OR REPLACE FUNCTION public.can_access_expired_applications()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin'])
      OR public.is_training_team_member();
$$;
