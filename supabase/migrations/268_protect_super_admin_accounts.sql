-- 267 — A Super Admin's account is only a Super Admin's to change
--
-- Migration 263 gave General Admins (`admin`) every power a super_admin has
-- except the Records Library. That swept in the power to switch off, delete,
-- convert, re-title and demote a super admin. The API routes now refuse all
-- of those (src/lib/auth/super-admin-target.ts). This migration closes the
-- same door underneath them: the 002 policies let ANY admin write
-- user_roles and users directly through their own session, so a General
-- Admin could skip the routes entirely — including inserting super_admin for
-- themselves, which the grant-role route forbids.
--
--   1. is_super_admin_account(uuid) — does this account hold super_admin?
--   2. user_roles INSERT: a General Admin can't grant super_admin, and can't
--      add any role to a super admin.
--   3. user_roles DELETE: a General Admin can't remove any role from a
--      super admin (titles, membership, admin tiers, super_admin itself).
--   4. users UPDATE trigger: through a user session, only a super admin may
--      deactivate a super admin or change their job title or login email.
--      Service-role writes (auth.uid() IS NULL) pass — the API routes guard
--      those, and the merge / Slack sync / cron jobs must keep working.
--
-- Super admins are unaffected. Safe to re-run.

-- ── 1. Is this account a super admin? ───────────────────────

CREATE OR REPLACE FUNCTION public.is_super_admin_account(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin_account(uuid) TO authenticated;

-- ── 2. Granting roles ───────────────────────────────────────

DROP POLICY IF EXISTS "Admins can manage user roles" ON public.user_roles;

CREATE POLICY "Admins can manage user roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (
    public.has_any_role(ARRAY['super_admin'])
    OR (
      public.is_admin()
      AND NOT public.is_super_admin_account(user_roles.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = user_roles.role_id
          AND r.name = 'super_admin'
      )
    )
  );

-- ── 3. Removing roles ───────────────────────────────────────

DROP POLICY IF EXISTS "Admins can delete user roles" ON public.user_roles;

CREATE POLICY "Admins can delete user roles"
  ON public.user_roles FOR DELETE
  USING (
    public.has_any_role(ARRAY['super_admin'])
    OR (
      public.is_admin()
      AND NOT public.is_super_admin_account(user_roles.user_id)
    )
  );

-- ── 4. Account standing on users ────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_super_admin_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role, SQL editor, cron: not a person's session.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only deactivation, the job title and the login email are guarded;
  -- reactivating and ordinary profile fields stay open to any admin.
  IF NOT (OLD.is_active AND NOT NEW.is_active)
     AND NEW.job_title IS NOT DISTINCT FROM OLD.job_title
     AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(ARRAY['super_admin'])
     OR NOT public.is_super_admin_account(OLD.id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a Super Admin can change a Super Admin''s account.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS users_guard_super_admin_account ON public.users;
CREATE TRIGGER users_guard_super_admin_account
  BEFORE UPDATE OF is_active, job_title, email ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_super_admin_account();
