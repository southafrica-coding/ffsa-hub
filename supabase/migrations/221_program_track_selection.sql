-- ============================================================
-- FFSA Hub — Migration 221: program track selection
-- ============================================================
-- Some schools (FFX: FFX/FFBX/FFWV) run as either a whole program or
-- standalone 3-month segments (billing_courses, scope='segment'). Nothing
-- previously recorded which a student chose — every acceptance defaulted
-- silently to whole-program billing, and there was no way to see headcounts
-- per segment. These two tables are the track-of-record: one row per
-- (application|enrollment, segment) chosen, with billing_course_id NULL
-- meaning "whole program" — mirroring the nullable-FK + partial-unique-index
-- pattern student_billing_plans already uses (098/101) for the same
-- whole-program-vs-segment distinction. A student may pick any combination
-- of segments, so this is a set of rows, not a single column.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. APPLICATION_SEGMENT_CHOICES — the applicant's stated intent
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.application_segment_choices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_response_id uuid NOT NULL REFERENCES public.application_responses(id) ON DELETE CASCADE,
  billing_course_id       uuid REFERENCES public.billing_courses(id) ON DELETE CASCADE, -- NULL = whole program
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX asc_response_whole_program
  ON public.application_segment_choices (application_response_id)
  WHERE billing_course_id IS NULL;
CREATE UNIQUE INDEX asc_response_course_key
  ON public.application_segment_choices (application_response_id, billing_course_id)
  WHERE billing_course_id IS NOT NULL;

CREATE INDEX idx_asc_response ON public.application_segment_choices(application_response_id);

-- Written only by the public application route via the service-role
-- (admin) client, same as application_responses itself — staff just read.
ALTER TABLE public.application_segment_choices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read application segment choices"
  ON public.application_segment_choices FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ────────────────────────────────────────────────────────────
-- 2. ENROLLMENT_SEGMENTS — the enrolled student's track of record
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.enrollment_segments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  billing_course_id  uuid REFERENCES public.billing_courses(id) ON DELETE CASCADE, -- NULL = whole program
  created_by         uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX es_enrollment_whole_program
  ON public.enrollment_segments (enrollment_id)
  WHERE billing_course_id IS NULL;
CREATE UNIQUE INDEX es_enrollment_course_key
  ON public.enrollment_segments (enrollment_id, billing_course_id)
  WHERE billing_course_id IS NOT NULL;

CREATE INDEX idx_es_enrollment ON public.enrollment_segments(enrollment_id);

-- Mirrors billing_courses: authenticated read, finance/admin write. Written
-- by the acceptance flow (service-role client, bypasses RLS) and by the
-- finance student-program-billing route (RLS-scoped, finance_admin/admin).
ALTER TABLE public.enrollment_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read enrollment segments"
  ON public.enrollment_segments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Finance can insert enrollment segments"
  ON public.enrollment_segments FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update enrollment segments"
  ON public.enrollment_segments FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete enrollment segments"
  ON public.enrollment_segments FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- No student has both a whole-program row and a segment row:
--   SELECT enrollment_id, count(*) FROM enrollment_segments
--     GROUP BY enrollment_id
--    HAVING bool_or(billing_course_id IS NULL) AND bool_or(billing_course_id IS NOT NULL);
--   -- expect: 0 rows (the two partial unique indexes don't prevent this
--   -- combination on their own — application code is responsible for
--   -- writing one or the other, never both, per enrollment)
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.enrollment_segments;
--   DROP TABLE IF EXISTS public.application_segment_choices;
-- ------------------------------------------------------------
