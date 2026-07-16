-- ============================================================
-- Schools managers can READ enrollments for programs they manage
-- ============================================================
-- Background:
--   public.enrollments had SELECT policies only for: own row,
--   is_admin(), finance_admin, and assigned staff. Program-scoped
--   schools managers (has_schools_access / schools.* permissions)
--   could INSERT/UPDATE/DELETE enrollments (migrations 020, 040, 121)
--   but could NOT read them back — so the Enrollments tab rendered
--   empty for a non-admin program leader, while the Applicants tab
--   worked because application_responses already grants this SELECT
--   (040_scoped_permission_checks.sql).
--
-- Fix:
--   Add the missing SELECT policy, mirroring the visibility already
--   granted on application_responses so the Enrollments tab is visible
--   to everyone who can see the Applicants tab. Additive only — no
--   existing policy is dropped; own-row / admin / finance_admin /
--   assigned-staff reads continue to work (SELECT policies are OR'd).
-- ============================================================

CREATE POLICY "Schools managers can read all enrollments"
  ON public.enrollments FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.has_schools_access(program_id)
    OR public.has_permission_for('schools.manage_enrollments', program_id)
    OR public.has_permission_for('schools.view_applications', program_id)
    OR public.has_permission_for('schools.approve_applications', program_id)
  );
