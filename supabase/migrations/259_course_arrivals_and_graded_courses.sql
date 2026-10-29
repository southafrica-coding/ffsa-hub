-- ============================================================
-- FFSA Hub — Migration 259: arrival per course + graded courses
-- ============================================================
-- A school split into courses (FFX: FFX / FFBX / FFWX) had one arrival status
-- per student for the whole year (enrollments.status). Someone can arrive for
-- FFX and then not come back for FFBX, and that could not be recorded.
--
-- 1. enrollment_course_arrivals — one row per (enrolment, course) once staff
--    mark it on the Arrival tab. No row = still waiting. enrollments.status
--    stays the school-wide summary every other screen and cron reads; the
--    API keeps it in step (any course arrived → 'arrived').
-- 2. billing_courses.graded — FFX is never graded; FFBX and FFWX are. The
--    roster and Overview only count graded courses on a student's track.
--
-- Additive only. Safe to run before the code that uses it deploys.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENROLLMENT_COURSE_ARRIVALS
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.enrollment_course_arrivals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  billing_course_id  uuid NOT NULL REFERENCES public.billing_courses(id) ON DELETE CASCADE,
  status             text NOT NULL CHECK (status IN ('arrived', 'no_show')),
  marked_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  marked_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, billing_course_id)
);

CREATE INDEX idx_eca_enrollment ON public.enrollment_course_arrivals(enrollment_id);
CREATE INDEX idx_eca_course ON public.enrollment_course_arrivals(billing_course_id);

-- Read like enrollment_segments (221). Written only by the course-arrival
-- route through the service-role client after a per-school permission check.
ALTER TABLE public.enrollment_course_arrivals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read course arrivals"
  ON public.enrollment_course_arrivals FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert course arrivals"
  ON public.enrollment_course_arrivals FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update course arrivals"
  ON public.enrollment_course_arrivals FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete course arrivals"
  ON public.enrollment_course_arrivals FOR DELETE
  USING (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- 2. BILLING_COURSES.GRADED
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.billing_courses
  ADD COLUMN IF NOT EXISTS graded boolean NOT NULL DEFAULT true;

-- Rollback:
--   DROP TABLE IF EXISTS public.enrollment_course_arrivals;
--   ALTER TABLE public.billing_courses DROP COLUMN IF EXISTS graded;
