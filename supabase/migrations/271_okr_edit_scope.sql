-- ============================================================
-- FFSA Hub — Migration 271: OKRs are changed by their own ministry
-- ============================================================
-- Found in testing: anyone on the Leadership Team could edit or delete ANY
-- ministry's objectives and key results. That was by design in 182 — the
-- trigger-synced 'leadership_team' role sat in can_edit_okr_objective() and
-- can_create_okr() beside is_admin() — and 183 granted it the matching
-- okrs.manage_all marker ("Edit Any Ministry or Individual OKR").
--
-- The rule is now:
--
--   READ (unchanged)   ministry objectives: every signed-in user.
--                      individual objectives: the owner, that ministry's
--                      leaders, the Leadership Team and admins.
--   CHANGE             admin / super_admin (is_admin), an active leader of
--                      the objective's ministry (leads_staff_ministry), or
--                      the owner of an individual objective. Not the
--                      Leadership Team.
--   CHECK-INS          adding one needs CHANGE rights on its key result (as
--                      before, via can_edit_okr_key_result). Amending or
--                      removing one: its author or an admin. Leadership is
--                      dropped here too — it was the same cross-ministry hole.
--   CYCLES             unchanged: admins and the Leadership Team still open
--                      and close cycles (set_current_okr_cycle, okr_cycles
--                      policies). A cycle is base-wide, not one ministry's.
--
-- Only the two helper functions and two check-in policies change. Every
-- objective / key-result policy already calls the helpers, so they pick the
-- new rule up without being re-created. OKR-only teams (staff_ministry_id
-- NULL) become admin-only, because leads_staff_ministry(NULL) collapses to
-- is_admin(); all of them were retired in 250 anyway.
--
-- The app mirrors this in src/lib/auth/check-okr-access.ts (canChangeOkr,
-- canAmendCheckin) — keep the two in step.
--
-- Depends on 126 (leads_staff_ministry), 182 (OKR tables + helpers),
-- 183 (okrs permissions). Idempotent: safe to re-paste.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. EDIT / CREATE HELPERS — leadership_team removed
-- ────────────────────────────────────────────────────────────
-- leads_staff_ministry() already folds in is_admin(); the explicit
-- is_admin() is kept so the rule reads in one place.

CREATE OR REPLACE FUNCTION public.can_edit_okr_objective(target_objective_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.okr_objectives o
     WHERE o.id = target_objective_id
       AND (
            public.is_admin()
         OR public.leads_staff_ministry(o.staff_ministry_id)
         OR (o.scope = 'individual' AND o.owner_user_id = auth.uid())
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_okr(
  p_scope         public.okr_scope,
  p_ministry_id   uuid,
  p_owner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.leads_staff_ministry(p_ministry_id)
      OR (p_scope = 'individual' AND p_owner_user_id = auth.uid());
$$;


-- ────────────────────────────────────────────────────────────
-- 2. CHECK-INS — author or admin
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "OKR check-ins editable by author or leadership" ON public.okr_checkins;
DROP POLICY IF EXISTS "OKR check-ins editable by author or admin" ON public.okr_checkins;
CREATE POLICY "OKR check-ins editable by author or admin"
  ON public.okr_checkins FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin())
  WITH CHECK (author_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "OKR check-ins deletable by author or leadership" ON public.okr_checkins;
DROP POLICY IF EXISTS "OKR check-ins deletable by author or admin" ON public.okr_checkins;
CREATE POLICY "OKR check-ins deletable by author or admin"
  ON public.okr_checkins FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin());


-- ────────────────────────────────────────────────────────────
-- 3. PERMISSION MARKER
-- ────────────────────────────────────────────────────────────
-- okrs.manage_all was never read by the app or by RLS (183 says so); it only
-- told the Roles screen that the Leadership Team could edit every OKR. That
-- is no longer true, so the grant goes. The permission row itself stays —
-- removing it would orphan any per-user grant made through Users & Roles.

DELETE FROM public.role_permissions rp
 USING public.roles r, public.permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.name = 'leadership_team'
   AND p.key = 'okrs.manage_all';


-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Neither helper mentions leadership_team any more:
--   SELECT proname, prosrc LIKE '%leadership_team%' AS still_leadership
--     FROM pg_proc
--    WHERE proname IN ('can_edit_okr_objective', 'can_create_okr');
--     -- expect: both false
--
--   -- Check-in policies renamed:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'okr_checkins' ORDER BY policyname;
--     -- expect: "...deletable by author or admin" (DELETE),
--     --         "...editable by author or admin" (UPDATE),
--     --         "...insertable by editors", "...readable by audience"
--
--   -- Leadership keeps view + cycles, loses manage_all:
--   SELECT p.key FROM public.role_permissions rp
--     JOIN public.roles r ON r.id = rp.role_id AND r.name = 'leadership_team'
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE p.module = 'okrs' ORDER BY p.key;
--     -- expect: okrs.manage_cycles, okrs.view
--
--   -- As a LEADERSHIP TEAM member who leads ministry X only (inside a
--   -- transaction you roll back):
--   SELECT public.can_edit_okr_objective('<objective in X>');   -- true
--   SELECT public.can_edit_okr_objective('<objective in Y>');   -- false
--   SELECT public.can_view_okr_objective('<ministry objective in Y>'); -- true
--   BEGIN;
--   DELETE FROM public.okr_objectives WHERE id = '<objective in Y>';   -- DELETE 0
--   ROLLBACK;
-- ============================================================
