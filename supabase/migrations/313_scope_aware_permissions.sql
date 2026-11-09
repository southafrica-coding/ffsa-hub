-- ============================================================
-- FFSA Hub — Migration 313: scope-aware schools deletes + active-only permissions
-- ============================================================
-- Problem (Hub Backend, 9 Nov 2026): public.has_permission (089) ignores
-- the scope on user_roles and user_permissions, and ignores
-- users.is_active. A grant scoped to one program therefore passes every
-- policy that calls has_permission(key) or has_schools_access() (no
-- argument) for every program. Worst case: 223's DELETE on
-- application_responses, which lets a holder scoped to program A
-- permanently delete applications in program B.
--
-- Design: option (b), the smallest blast radius.
--   * has_permission keeps its meaning (any grant, scoped or not), so the
--     ~110 policies and ~25 functions that call it for global modules
--     (contacts, comms, bookings, vehicles, equipment, ...) are untouched.
--   * The schools policies that still call the unscoped checks, on tables
--     that carry a program id, now pass that program id:
--       application_responses DELETE   (223)
--       enrollments DELETE
--       grades INSERT / UPDATE         (program via the enrollment)
--     Each new expression is a subset of the old one: is_admin(), or the
--     same keys through has_permission_for(key, row program). Nobody gains.
--   * has_permission and has_permission_for count active accounts only
--     (users.is_active IS NOT FALSE, mirroring middleware.ts, which locks
--     out is_active = false). service_role has no auth.uid() and was already
--     false, so server paths are unchanged.
--
-- Not in this migration (see REVIEW.md): event-scoped events.* grants and
-- program-scoped finance.* grants also pass unscoped has_permission checks;
-- the shared application_templates library is still writable by any
-- schools.manage holder. Those need app-side confirmation first.
--
-- Same signatures, owners and grants as live. Idempotent: CREATE OR
-- REPLACE, DROP POLICY IF EXISTS + CREATE POLICY.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Active accounts only. Scope semantics unchanged.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND (
    EXISTS (
      -- direct grant (any scope, as in 089)
      SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
      WHERE up.user_id = auth.uid()
        AND p.key = required_permission
    )
    OR EXISTS (
      -- via an assigned role's bundle (any scope, as in 089)
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = required_permission
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission_for(required_permission text, target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND (
    EXISTS (
      -- direct grant (global or scoped to this program)
      SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
      WHERE up.user_id = auth.uid()
        AND p.key = required_permission
        AND (
          up.scope_type IS NULL
          OR (up.scope_type = 'program' AND up.scope_id = target_program_id)
        )
    )
    OR EXISTS (
      -- via an assigned role's bundle (global or scoped to this program)
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = required_permission
        AND (
          ur.scope_type IS NULL
          OR (ur.scope_type = 'program' AND ur.scope_id = target_program_id)
        )
    )
  );
$$;

-- Live ACL is PUBLIC + anon + authenticated + service_role. Policies on
-- tables open to anon (e.g. "Open feedback forms readable by anyone")
-- call has_permission, so EXECUTE for anon must stay. Re-asserted as-is.
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission_for(text, uuid) TO PUBLIC, anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Program of an enrollment, for grades policies. Definer so the
--    lookup does not depend on the caller's enrollments visibility.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enrollment_program_id(p_enrollment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.program_id FROM public.enrollments e WHERE e.id = p_enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.enrollment_program_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_program_id(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Schools policies: pass the row's program.
--    Old: has_schools_access()  = is_admin() OR has_permission('schools.manage')
--    New: is_admin() OR has_permission_for('schools.manage', <row program>)
--    (is_program_leader is deliberately NOT added: no broadening.)
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Schools managers can delete application responses" ON public.application_responses;
CREATE POLICY "Schools managers can delete application responses"
  ON public.application_responses FOR DELETE
  USING (
    public.application_gate(
      program_id,
      public.is_admin()
        OR public.has_permission_for('schools.manage', program_id)
        OR public.has_permission_for('schools.approve_applications', program_id)
    )
  );

DROP POLICY IF EXISTS "Schools managers can delete enrollments" ON public.enrollments;
CREATE POLICY "Schools managers can delete enrollments"
  ON public.enrollments FOR DELETE
  USING (
    public.is_admin()
    OR public.has_permission_for('schools.manage', program_id)
    OR public.has_permission_for('schools.manage_enrollments', program_id)
  );

DROP POLICY IF EXISTS "Schools managers can insert grades" ON public.grades;
CREATE POLICY "Schools managers can insert grades"
  ON public.grades FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_permission_for('schools.manage', public.enrollment_program_id(enrollment_id))
  );

DROP POLICY IF EXISTS "Schools managers can update grades" ON public.grades;
CREATE POLICY "Schools managers can update grades"
  ON public.grades FOR UPDATE
  USING (
    public.is_admin()
    OR public.has_permission_for('schools.manage', public.enrollment_program_id(enrollment_id))
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_permission_for('schools.manage', public.enrollment_program_id(enrollment_id))
  );
