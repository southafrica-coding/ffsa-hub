-- ============================================================
-- FFSA Hub — Migration 274: "outreach limited to own teams"
-- ============================================================
-- Safe to run twice: the table is IF NOT EXISTS, functions are
-- CREATE OR REPLACE, every policy is dropped by name before it is created
-- again, and the one seeded row is ON CONFLICT DO NOTHING.
--
-- A finance.view or finance.edit grant normally makes someone outreach
-- staff: they read (finance.view) or change (finance.edit) EVERY outreach
-- team — is_outreach_staff_viewer() / is_outreach_staff_editor() from
-- migration 260. Some people need those grants for the rest of Finance but
-- should only see their own outreach teams.
--
-- This migration adds a per-person flag for that. When it is on, the
-- finance.view / finance.edit path into all-team outreach access is closed
-- for that person, and nothing else changes:
--
--   * Their finance.view / finance.edit grants stay exactly as they are and
--     keep working everywhere outside outreach (has_permission() is not
--     touched).
--   * They keep everything their own teams give them (owner, co-leader,
--     member) and everything the outreach groups they manage give them —
--     those paths never went through the staff helpers.
--   * Super Admin, General Admin (is_admin()) and the finance_admin role
--     are NOT affected: the flag only removes the permission-based path.
--
-- Every outreach policy, helper and RPC that hands out all-team access
-- goes through is_outreach_staff_viewer() / is_outreach_staff_editor() —
-- directly, or via can_view_outreach_team(), can_edit_outreach_team(),
-- can_edit_outreach_budget(), is_outreach_finance_admin(),
-- can_add_outreach_category(), can_manage_outreach_group(),
-- outreach_group_team_directory(), outreach_team_overview(), the archive /
-- delete RPCs (272) and the group-table policies (273). Narrowing the two
-- staff helpers is therefore enough to apply the flag everywhere at once;
-- no policy is rebuilt.
--
-- NOBODY ELSE LOSES ACCESS: for anyone without the flag both helpers
-- return exactly what they did before. user_roles and user_permissions
-- are not touched.
--
-- Seeds the flag ON for the person whose sign-in email is
-- stephankuhn05@gmail.com (a no-op if there is no such user).
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_user_restrictions (
  user_id              uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  -- On: finance.view / finance.edit no longer open every outreach team.
  limited_to_own_teams boolean NOT NULL DEFAULT true,
  set_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_user_restrictions ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 2. Helpers
-- ────────────────────────────────────────────────────────────
-- The caller's outreach is limited to their own teams. SECURITY DEFINER so
-- the staff helpers below can read the flag whatever the caller's RLS.
CREATE OR REPLACE FUNCTION public.is_outreach_limited_to_own_teams()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_user_restrictions
    WHERE user_id = auth.uid() AND limited_to_own_teams
  );
$$;

-- Outreach staff who may read every team: migration 260's rule, with the
-- finance.view / finance.edit path closed for flagged people.
CREATE OR REPLACE FUNCTION public.is_outreach_staff_viewer()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR (
      (public.has_permission('finance.view') OR public.has_permission('finance.edit'))
      AND NOT public.is_outreach_limited_to_own_teams()
    );
$$;

-- Outreach staff who may change every team: same carve-out.
CREATE OR REPLACE FUNCTION public.is_outreach_staff_editor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR (
      public.has_permission('finance.edit')
      AND NOT public.is_outreach_limited_to_own_teams()
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_outreach_limited_to_own_teams() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_staff_viewer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_staff_editor() TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 3. Policies
-- ────────────────────────────────────────────────────────────
-- Admins (Super Admin, General Admin) read and set everyone's flag; a
-- person may read their own row and nothing else.
DROP POLICY IF EXISTS "Read outreach restrictions" ON public.outreach_user_restrictions;
DROP POLICY IF EXISTS "Add outreach restrictions" ON public.outreach_user_restrictions;
DROP POLICY IF EXISTS "Change outreach restrictions" ON public.outreach_user_restrictions;
DROP POLICY IF EXISTS "Remove outreach restrictions" ON public.outreach_user_restrictions;

CREATE POLICY "Read outreach restrictions" ON public.outreach_user_restrictions FOR SELECT
  USING (public.is_admin() OR user_id = auth.uid());
CREATE POLICY "Add outreach restrictions" ON public.outreach_user_restrictions FOR INSERT
  WITH CHECK (public.is_admin());
CREATE POLICY "Change outreach restrictions" ON public.outreach_user_restrictions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY "Remove outreach restrictions" ON public.outreach_user_restrictions FOR DELETE
  USING (public.is_admin());


-- ────────────────────────────────────────────────────────────
-- 4. Seed: Stefan Keen
-- ────────────────────────────────────────────────────────────
-- Looked up by sign-in email. No such user → no row. Already has a row →
-- left alone, so re-running never overrides an admin's later choice.
INSERT INTO public.outreach_user_restrictions (user_id, limited_to_own_teams)
SELECT u.id, true
FROM auth.users au
JOIN public.users u ON u.id = au.id
WHERE lower(au.email) = lower('stephankuhn05@gmail.com')
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================
-- Verify:
--   SELECT r.user_id, au.email, r.limited_to_own_teams
--   FROM public.outreach_user_restrictions r
--   JOIN auth.users au ON au.id = r.user_id;
--
--   -- As the flagged person (SQL editor: set the JWT claim first):
--   --   SELECT set_config('request.jwt.claims', '{"sub":"<user id>"}', true);
--   SELECT public.has_permission('finance.view'),      -- still true
--          public.is_outreach_staff_viewer(),          -- now false
--          public.is_outreach_staff_editor();          -- now false
--   --   SET LOCAL ROLE authenticated;  (inside a transaction, so RLS applies)
--   SELECT count(*) FROM public.outreach_teams;        -- own teams only
-- ============================================================
