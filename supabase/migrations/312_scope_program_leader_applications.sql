-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 312: scope the program_leader role in
-- can_manage_program_applications(program)
-- ============================================================
-- Last defined in 304_program_staff.sql. Its final branch accepted ANY
-- user_roles row for the program_leader role and ignored scope_type /
-- scope_id, so a program_leader scoped to one school counted as a
-- manager of every school's applications, admin notes, staff reviews
-- (304/306) and, through lms_can_edit (305), every school's classroom.
--
-- New rule for that branch (the rest is unchanged):
--   • program_leader with scope_type = 'program' → only that program
--   • program_leader with no scope (scope_type IS NULL) → every program.
--     Same meaning has_permission_for() gives every unscoped grant, and the
--     role's own bundle (schools.manage) already makes an unscoped holder
--     has_schools_access everywhere, so "nowhere" would not remove access.
--   • program_leader scoped to a team / event → no program.
-- Admins, named leaders (program_leaders), schools.manage /
-- approve_applications / manage_enrollments (global or this program) are
-- untouched.
--
-- Same signature, return type, volatility, SECURITY DEFINER and owner, so
-- the policies on application_admin_notes / application_staff_reviews,
-- guard_application_staff_review(), application_review_write_allowed()
-- and lms_can_edit() pick it up with no other change.
--
-- Live impact on 9 Nov 2026 (rolled-back simulation): 0 users change.
-- Both program_leader holders also hold unscoped schools.* grants.
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_program_applications(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_schools_access(target_program_id)
      OR public.has_permission_for('schools.approve_applications', target_program_id)
      OR public.has_permission_for('schools.manage_enrollments', target_program_id)
      OR EXISTS (
        SELECT 1
          FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id
         WHERE ur.user_id = auth.uid()
           AND r.name = 'program_leader'
           AND (
             ur.scope_type IS NULL
             OR (ur.scope_type = 'program' AND ur.scope_id = target_program_id)
           )
      );
$$;

COMMENT ON FUNCTION public.can_manage_program_applications(uuid) IS
  'Admins, named program leaders, schools.manage / approve_applications / manage_enrollments (global or this program), and the program_leader role when unscoped or scoped to this program (312).';

REVOKE ALL ON FUNCTION public.can_manage_program_applications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_program_applications(uuid) TO authenticated, service_role;

-- Verify after applying:
--   SELECT pg_get_functiondef('public.can_manage_program_applications(uuid)'::regprocedure);
--   SELECT has_function_privilege('anon', 'public.can_manage_program_applications(uuid)', 'EXECUTE');  -- false
