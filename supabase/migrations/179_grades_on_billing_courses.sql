-- ============================================================
-- FFSA Hub — Grades move onto billing_courses
-- ============================================================
-- Frame 14b (docs/redesign/08-training-and-messages.md §2) draws the grades
-- matrix with one column per course, headed by code · name · credits. It has
-- to key off the course model Training actually manages.
--
-- Two course tables have coexisted since 098:
--   · courses          — the original academic table. Its admin UI (CoursesTab)
--                        was orphaned; 1 row exists across 3 programs and the
--                        grades table is empty.
--   · billing_courses  — created by 098 as the chronological course model, and
--                        the one the live "Courses" tab writes through
--                        (ProgramCoursesManager). 5 rows, all real.
--
-- 098 kept them separate deliberately ("billing_courses is kept SEPARATE from
-- the academic courses table"). In practice only billing_courses was ever
-- maintained, so Training's course structure lives there and this re-points
-- grades to match. `courses` is left in place, unused, rather than dropped —
-- removing it is a separate decision.
--
-- Safe to run as a straight swap: `SELECT count(*) FROM grades` is 0, so
-- there is nothing to migrate and no orphan rows are possible.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Credit hours on billing_courses
-- ────────────────────────────────────────────────────────────
-- The academic table carried credit_hours; billing_courses never did. The
-- matrix header ("3 CR") and the transcript's GPA weighting both need it.
ALTER TABLE public.billing_courses
  ADD COLUMN IF NOT EXISTS credit_hours integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billing_courses.credit_hours IS
  'Credit hours for this course. Weights the GPA on the transcript and heads the grades matrix column.';

-- ────────────────────────────────────────────────────────────
-- 2. Re-point grades.course_id at billing_courses
-- ────────────────────────────────────────────────────────────
-- Guard rather than assume: if grade rows ever exist when this runs, stop
-- instead of silently dropping them through the FK swap.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.grades;
  IF n > 0 THEN
    RAISE EXCEPTION
      'grades has % row(s); this migration assumes an empty table. Migrate the rows onto billing_courses ids first.', n;
  END IF;
END $$;

ALTER TABLE public.grades
  DROP CONSTRAINT IF EXISTS grades_course_id_fkey;

ALTER TABLE public.grades
  ADD CONSTRAINT grades_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES public.billing_courses(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.grades.course_id IS
  'FK to billing_courses (migration 179). Was courses(id) until then; see the header of that migration.';

-- The UNIQUE (enrollment_id, course_id) constraint and both indexes are
-- unchanged — they never referenced the courses table.
