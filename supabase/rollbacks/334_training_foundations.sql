-- ============================================================
-- Rollback for 334_training_foundations.sql
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Drops only the objects migration 334 created.
-- enrollments.assigned_staff_id (migration 052) is untouched, so the
-- website keeps working exactly as before 334. Check-ins and their
-- staff-only notes are deleted with their tables: export them first
-- if any are real.
-- ============================================================

DROP POLICY IF EXISTS "Walkers can read their enrollments" ON public.enrollments;
DROP TRIGGER IF EXISTS enrollments_mirror_assigned_staff ON public.enrollments;

DROP FUNCTION IF EXISTS public.my_checkin_notes();

DROP TABLE IF EXISTS public.today_dismissals;
DROP TABLE IF EXISTS public.student_checkin_private;
DROP TABLE IF EXISTS public.student_checkins;
DROP TABLE IF EXISTS public.enrollment_staff;

DROP FUNCTION IF EXISTS public.can_manage_checkin(uuid);
DROP FUNCTION IF EXISTS public.can_read_checkin_private(uuid);
DROP FUNCTION IF EXISTS public.is_checkin_author(uuid);
DROP FUNCTION IF EXISTS public.student_checkins_guard();
DROP FUNCTION IF EXISTS public.enrollment_staff_mirror_assigned();
DROP FUNCTION IF EXISTS public.training_touch_updated_at();
DROP FUNCTION IF EXISTS public.is_school_staff_for_enrollment(uuid);
DROP FUNCTION IF EXISTS public.is_own_enrollment(uuid);
DROP FUNCTION IF EXISTS public.walking_with_enrollment_ids();
DROP FUNCTION IF EXISTS public.is_walking_with(uuid);
DROP FUNCTION IF EXISTS public.training_enrollment_program(uuid);
