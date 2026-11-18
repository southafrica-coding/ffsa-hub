-- ============================================================
-- Rollback for 335_activity_events_select_staff.sql
-- ============================================================
-- DRAFT. Restores 043's policy, which lets EVERY signed-in user
-- (students included) read every contact's timeline. Only use this
-- if 335 breaks a staff screen, and re-apply a fix quickly.
-- anon's table grant is not restored: anon never had a policy.
-- ============================================================

BEGIN;
DROP POLICY IF EXISTS "Staff can read activity events" ON public.activity_events;
DROP POLICY IF EXISTS "Auth users can read activity events" ON public.activity_events;
CREATE POLICY "Auth users can read activity events"
  ON public.activity_events FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMIT;
