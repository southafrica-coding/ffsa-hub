-- ============================================================
-- FFSA Hub — Migration 294: schools LMS tables
-- ============================================================
-- DO NOT APPLY to production until Hub Data and Jack approve.
-- Complements draft PR #501 (schools LMS API). This file is the
-- numbered migration that PR deliberately did not add. It does not
-- change application code.
--
-- 293 is reserved for the sibling evangelism migration. Not used here.
--
-- WHAT THIS ADDS (four new tables, in this order, then same-school
-- triggers). Triggers on billing_courses.program_id and
-- enrollments.program_id only reject a move that would split a mark,
-- grader, or school-specific outline. They do not add policies.
--   1. course_design_templates — a reusable course design.
--      program_id NULL is base-wide (not owned by one school).
--   2. course_outlines — the design saved onto one billing course.
--      One row per billing_courses id. Copying a template does not
--      keep the outline tied to later template edits.
--   3. course_graders — who may mark, scoped to a school plus a
--      course, a student, or both. can_post_official is the flag the
--      #501 official-grade route will read. Service role writes it.
--   4. grade_marks — one letter per grader per student per course.
--      Notes live on this row. The official transcript letter stays
--      on the existing grades table.
--
-- NOT TOUCHED (intentionally):
--   * billing_courses INSERT/UPDATE/DELETE policies (migration 098).
--     Training leaders keep writing course shells through the service
--     role, after the API's own permission check. This migration does
--     not grant schools a write policy on billing_courses.
--   * grades policies. Official letters still go through the service
--     role (POST /api/schools/grades/official in #501).
--   * fee_charge_items and billing-plan policies. Those stay with finance.
--   * The academic courses table. Still unused. Not dropped.
--
-- ROW LEVEL SECURITY:
--   Enabled on all four tables, with no policies, and table privileges
--   revoked from PUBLIC, anon, and authenticated. The Data API role
--   authenticated therefore cannot SELECT, INSERT, UPDATE, or DELETE.
--   service_role (which bypasses RLS) is granted DML so the #501 routes
--   can keep using the service-role client after their own checks.
--
--   has_schools_access() is not called. On this project the live
--   zero-argument function is admin OR unscoped schools.manage
--   (confirmed read-only: Postgres 17.6, server_version_num 170006).
--   A policy that used it would treat a global schools manager as
--   access to every school. No authenticated policy is created, and
--   nothing here assumes a program_leader may manage every school.
--
--   grade_marks is included. Students must not SELECT it: notes are a
--   column on the row, and RLS cannot hide one column. No student
--   (and no other authenticated session) is given a SELECT policy.
--
-- DELETE BEHAVIOUR:
--   Letters and private notes on grade_marks are not removed by a
--   course, enrolment, school, or user delete.
--   * grade_marks.enrollment_id and grade_marks.billing_course_id are
--     ON DELETE RESTRICT. Deleting that course or that enrolment fails
--     while a mark exists; the row, the letter, and the note stay.
--     #501's course DELETE already returns 409 while transcript grades
--     (the grades table), fee items, or billing plans exist. That check
--     does not count grade_marks. RESTRICT is the database backstop so
--     a delete that skips the API cannot wipe grader notes.
--   * Enrolments are normally soft-removed (enrollments.removed_at,
--     migration 121). Soft-remove does not delete the row, so RESTRICT
--     does not apply to it. A later hard delete of the enrolment is
--     still RESTRICT, not CASCADE.
--   * Delete a school (programs) — CASCADE templates saved for that
--     school, and CASCADE grader assignment rows for that school.
--     Base-wide templates (program_id NULL) stay. Existing
--     billing_courses / enrollments foreign keys (098 and 006) still
--     cascade, but those deletes stop if grade_marks RESTRICT fires.
--     A school that still has marks is not deleted, and the marks are
--     not wiped. This migration does not change those existing keys
--     or any billing_courses / grades / fee-item policy.
--   * Delete a billing course — CASCADE that course's outline and the
--     grader rows that name that course, but only when the delete is
--     allowed. A grader row that names the course is the assignment
--     for that course, so it goes with the course. It does not go if
--     marks block the delete. Grader rows that do not name this course
--     stay. Marks for this course stay until someone deletes those
--     grade_marks rows on purpose.
--   * Delete a template — the outline keeps its copied design.
--     template_id is ON DELETE SET NULL. The outline row is not deleted.
--   * Delete an enrolment — grader rows that name that enrolment
--     CASCADE, but only when no mark blocks the delete. Course-wide
--     grader rows (enrollment_id NULL) stay. Marks stay.
--   * Delete a user who is a grader — CASCADE their course_graders
--     assignment rows (the assignment has no meaning without them).
--     grade_marks.grader_user_id is ON DELETE RESTRICT. This is
--     expected for offboarding: the account cannot be deleted while
--     letters or notes exist. Remove those marks on purpose first.
--     The delete does not wipe them and does not leave a dangling id.
--     Audit columns (created_by, updated_by, saved_by, assigned_by)
--     are ON DELETE SET NULL so removing a person does not delete a
--     design or an assignment.
--
-- PROGRAM CHECK:
--   A CHECK constraint cannot subquery. Constraint triggers, immediate:
--   * course_graders_same_program — billing_course_id, when set, is a
--     billing_courses row in course_graders.program_id, and
--     enrollment_id, when set, is an enrollments row in that same
--     program.
--   * grade_marks_same_program — the enrolment and the billing course
--     are in the same program. An enrolment from school A cannot be
--     paired with a course from school B. #501 already checks this in
--     the marks route; this is the database check.
--   * course_outlines_same_program — template_id, when set, is either
--     base-wide (course_design_templates.program_id NULL) or a template
--     for the outline's course school. A school-specific template
--     cannot be attached to another school's course.
--   Same-school checks also re-run when a course, enrolment, or
--   template changes program_id (lms_program_move_guard). The move is
--   rejected while a mark, grader row, or school-specific outline would
--   be left in the wrong school. Policies on billing_courses, grades,
--   and fee items are not changed. The guard is SECURITY DEFINER so a
--   finance update of billing_courses.program_id can be checked without
--   granting authenticated SELECT on grade_marks (notes must not leak).
--
-- updated_at: course_design_templates, course_outlines, and grade_marks
--   use the shared handle_updated_at() trigger (migration 001), so a
--   PATCH or upsert that does not send updated_at still refreshes it.
--   course_graders has no updated_at column (the #501 API does not
--   write one).
--
-- Postgres: NULLS NOT DISTINCT on course_graders_scope needs 15+.
--   This project's live server_version is 17.6. The index is what makes
--   one row per grader + scope, including the wide scopes where
--   billing_course_id or enrollment_id is NULL.
--
-- ROLLBACK is at the bottom. Run it by hand only. Nothing else in the
-- database references these four tables until #501 is deployed against
-- them.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. course_design_templates
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.course_design_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = base-wide design, not owned by one school. Deleting a school
  -- cascades only the templates that name it.
  program_id      uuid REFERENCES public.programs (id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  design          jsonb NOT NULL,
  schema_version  integer NOT NULL DEFAULT 1,
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_course_design_templates_program
  ON public.course_design_templates (program_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.course_design_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.course_design_templates ENABLE ROW LEVEL SECURITY;
-- No policies. Authenticated and anon are denied. service_role bypasses RLS.

REVOKE ALL ON TABLE public.course_design_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.course_design_templates TO service_role;

COMMENT ON TABLE public.course_design_templates IS
  'Reusable LMS course design (PR #501). program_id NULL is base-wide. RLS on, no authenticated policies; the schools API writes with the service role. Migration 294. Do not apply until Hub Data and Jack approve.';


-- ────────────────────────────────────────────────────────────
-- 2. course_outlines
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.course_outlines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1:1 with the billing course. Deleting the course deletes this copy.
  billing_course_id  uuid NOT NULL UNIQUE REFERENCES public.billing_courses (id) ON DELETE CASCADE,
  -- The outline keeps its design if the template is deleted.
  template_id        uuid REFERENCES public.course_design_templates (id) ON DELETE SET NULL,
  design             jsonb NOT NULL,
  schema_version     integer NOT NULL DEFAULT 1,
  saved_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_course_outlines_template
  ON public.course_outlines (template_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.course_outlines
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.course_outlines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.course_outlines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.course_outlines TO service_role;

COMMENT ON TABLE public.course_outlines IS
  'LMS design saved on one billing course (PR #501). Unique billing_course_id so the API can upsert onConflict billing_course_id. RLS on, no authenticated policies. Migration 294.';
COMMENT ON COLUMN public.course_outlines.template_id IS
  'Template this outline was copied from. ON DELETE SET NULL: deleting the template does not delete or rewrite the course outline. A school-specific template must belong to the course''s school; a base-wide template (program_id NULL) may be used by any school.';

-- School-specific template must match the course's school. Base-wide
-- templates (program_id NULL) are allowed on any course. #501 checks
-- this in the outline route; this is the database check.
CREATE OR REPLACE FUNCTION public.course_outlines_same_program()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_course_program uuid;
  v_template_program uuid;
BEGIN
  IF NEW.template_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT program_id INTO v_course_program
    FROM public.billing_courses
   WHERE id = NEW.billing_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'course_outlines.billing_course_id must belong to a course'
      USING ERRCODE = '23514';
  END IF;

  SELECT program_id INTO v_template_program
    FROM public.course_design_templates
   WHERE id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'course_outlines.template_id must belong to a template'
      USING ERRCODE = '23514';
  END IF;

  IF v_template_program IS NOT NULL
     AND v_template_program IS DISTINCT FROM v_course_program THEN
    RAISE EXCEPTION 'course_outlines.template_id must be base-wide or belong to the course school'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.course_outlines_same_program()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER course_outlines_same_program
  AFTER INSERT OR UPDATE OF billing_course_id, template_id
  ON public.course_outlines
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.course_outlines_same_program();

COMMENT ON FUNCTION public.course_outlines_same_program() IS
  'Rejects an outline whose template belongs to a different school. Base-wide templates (program_id NULL) are allowed. Does not call has_schools_access.';


-- ────────────────────────────────────────────────────────────
-- 3. course_graders
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.course_graders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          uuid NOT NULL REFERENCES public.programs (id) ON DELETE CASCADE,
  -- Naming a course: the row is that course's assignment, so the course
  -- delete cascades it (including when enrollment_id is also set).
  billing_course_id   uuid REFERENCES public.billing_courses (id) ON DELETE CASCADE,
  -- Naming a student: the enrolment delete cascades that assignment.
  -- Course-wide rows (enrollment_id NULL) are not enrolment children.
  enrollment_id       uuid REFERENCES public.enrollments (id) ON DELETE CASCADE,
  grader_user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  can_post_official   boolean NOT NULL DEFAULT false,
  assigned_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_graders_has_scope CHECK (
    billing_course_id IS NOT NULL OR enrollment_id IS NOT NULL
  )
);

-- One row per grader + school + scope. NULLS NOT DISTINCT so a second
-- course-wide row (enrollment_id NULL) or student-wide row
-- (billing_course_id NULL) conflicts. Requires Postgres 15+; live
-- server is 17.6.
CREATE UNIQUE INDEX course_graders_scope
  ON public.course_graders (grader_user_id, program_id, billing_course_id, enrollment_id)
  NULLS NOT DISTINCT;

CREATE INDEX idx_course_graders_program
  ON public.course_graders (program_id);
CREATE INDEX idx_course_graders_course
  ON public.course_graders (billing_course_id);
CREATE INDEX idx_course_graders_enrollment
  ON public.course_graders (enrollment_id);

-- Course and enrolment, when set, must belong to program_id.
-- CHECK cannot subquery. Constraint trigger, immediate.
CREATE OR REPLACE FUNCTION public.course_graders_same_program()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_program uuid;
BEGIN
  IF NEW.billing_course_id IS NOT NULL THEN
    SELECT program_id INTO v_program
      FROM public.billing_courses
     WHERE id = NEW.billing_course_id;
    IF NOT FOUND OR v_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'course_graders.billing_course_id must belong to program_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.enrollment_id IS NOT NULL THEN
    SELECT program_id INTO v_program
      FROM public.enrollments
     WHERE id = NEW.enrollment_id;
    IF NOT FOUND OR v_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'course_graders.enrollment_id must belong to program_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.course_graders_same_program()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER course_graders_same_program
  AFTER INSERT OR UPDATE OF program_id, billing_course_id, enrollment_id
  ON public.course_graders
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.course_graders_same_program();

ALTER TABLE public.course_graders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.course_graders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.course_graders TO service_role;

COMMENT ON TABLE public.course_graders IS
  'LMS grader assignment for one school, optionally one course and/or one enrolment (PR #501). RLS on, no authenticated policies. Migration 294.';
COMMENT ON FUNCTION public.course_graders_same_program() IS
  'Rejects a course_graders row whose billing course or enrolment is not in program_id. A later program move on the course or enrolment is re-checked by lms_program_move_guard. Does not call has_schools_access. Does not alter billing_courses or enrollments policies.';


-- ────────────────────────────────────────────────────────────
-- 4. grade_marks
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.grade_marks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, not CASCADE. Deleting the enrolment or the course must not
  -- wipe the letter or the private note. The delete fails; the row stays.
  -- Soft-remove (enrollments.removed_at) does not delete the enrolment.
  enrollment_id       uuid NOT NULL REFERENCES public.enrollments (id) ON DELETE RESTRICT,
  billing_course_id   uuid NOT NULL REFERENCES public.billing_courses (id) ON DELETE RESTRICT,
  -- RESTRICT: offboarding cannot delete this user while a mark exists.
  -- Letters and notes stay. The unique key includes this column, and it
  -- is NOT NULL, so SET NULL is not available. Remove the marks on
  -- purpose before deleting the account.
  grader_user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  letter_grade        text NOT NULL CHECK (letter_grade IN (
                        'A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F','W','I','P')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- #501 upserts onConflict enrollment_id,billing_course_id,grader_user_id.
  CONSTRAINT grade_marks_enrollment_course_grader_key
    UNIQUE (enrollment_id, billing_course_id, grader_user_id)
);

CREATE INDEX idx_grade_marks_course
  ON public.grade_marks (billing_course_id);
CREATE INDEX idx_grade_marks_grader
  ON public.grade_marks (grader_user_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.grade_marks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enrolment and course must be in the same school. Same shape as
-- course_graders_same_program. CHECK cannot subquery.
CREATE OR REPLACE FUNCTION public.grade_marks_same_program()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_course_program uuid;
  v_enrollment_program uuid;
BEGIN
  SELECT program_id INTO v_course_program
    FROM public.billing_courses
   WHERE id = NEW.billing_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grade_marks.billing_course_id must belong to the enrolment school'
      USING ERRCODE = '23514';
  END IF;

  SELECT program_id INTO v_enrollment_program
    FROM public.enrollments
   WHERE id = NEW.enrollment_id;
  IF NOT FOUND OR v_enrollment_program IS DISTINCT FROM v_course_program THEN
    RAISE EXCEPTION 'grade_marks.enrollment_id and billing_course_id must belong to the same school'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.grade_marks_same_program()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER grade_marks_same_program
  AFTER INSERT OR UPDATE OF enrollment_id, billing_course_id
  ON public.grade_marks
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.grade_marks_same_program();

ALTER TABLE public.grade_marks ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. notes is on the row; a student SELECT would
-- leak it, and RLS cannot hide a column. Authenticated is also revoked.

REVOKE ALL ON TABLE public.grade_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.grade_marks TO service_role;

COMMENT ON TABLE public.grade_marks IS
  'One LMS letter per grader per enrolment per billing course, including private notes (PR #501). Students have no SELECT. RLS on, no authenticated policies; service role only. Migration 294.';
COMMENT ON COLUMN public.grade_marks.notes IS
  'Private grader note. Not visible to students: there is no SELECT policy and authenticated has no table privilege.';
COMMENT ON COLUMN public.grade_marks.enrollment_id IS
  'ON DELETE RESTRICT. Hard-deleting the enrolment fails while a mark exists. Soft-remove (removed_at) does not delete the row.';
COMMENT ON COLUMN public.grade_marks.billing_course_id IS
  'ON DELETE RESTRICT. Deleting the billing course fails while a mark exists, so the letter and note are not cascaded away.';
COMMENT ON COLUMN public.grade_marks.grader_user_id IS
  'ON DELETE RESTRICT. Expected for offboarding: the user account cannot be deleted while a letter or note exists. Delete the mark on purpose first.';
COMMENT ON FUNCTION public.grade_marks_same_program() IS
  'Rejects a grade_marks row whose enrolment and billing course are in different schools. A later program move is re-checked by lms_program_move_guard. Does not call has_schools_access.';


-- ────────────────────────────────────────────────────────────
-- 5. Re-check same-school when a course, enrolment, or template
--    changes school. Does not change write policies.
-- ────────────────────────────────────────────────────────────
-- billing_courses and enrollments are existing tables. These triggers
-- only run when program_id actually changes, and they only raise when
-- a mark, grader row, or school-specific outline would be left pointing
-- at the wrong school. No LMS rows exist until this migration is
-- applied, so applying it does not fail any current update.
--
-- SECURITY DEFINER: a finance session can update billing_courses
-- (migration 098) but must not receive SELECT on grade_marks. An
-- invoker check would either miss the notes rows under RLS or fail
-- every program change with a permission error. The function compares
-- program ids and raises; it does not return notes.
CREATE OR REPLACE FUNCTION public.lms_program_move_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'billing_courses' THEN
    IF EXISTS (
      SELECT 1
        FROM public.grade_marks gm
        JOIN public.enrollments e ON e.id = gm.enrollment_id
       WHERE gm.billing_course_id = NEW.id
         AND e.program_id IS DISTINCT FROM NEW.program_id
    ) THEN
      RAISE EXCEPTION 'billing_courses.program_id cannot change while grade_marks tie this course to another school'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.course_graders g
        LEFT JOIN public.enrollments e ON e.id = g.enrollment_id
       WHERE g.billing_course_id = NEW.id
         AND (
           g.program_id IS DISTINCT FROM NEW.program_id
           OR (g.enrollment_id IS NOT NULL AND e.program_id IS DISTINCT FROM NEW.program_id)
         )
    ) THEN
      RAISE EXCEPTION 'billing_courses.program_id cannot change while course_graders tie this course to another school'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.course_outlines o
        JOIN public.course_design_templates t ON t.id = o.template_id
       WHERE o.billing_course_id = NEW.id
         AND t.program_id IS NOT NULL
         AND t.program_id IS DISTINCT FROM NEW.program_id
    ) THEN
      RAISE EXCEPTION 'billing_courses.program_id cannot change while the outline uses another school template'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'enrollments' THEN
    IF EXISTS (
      SELECT 1
        FROM public.grade_marks gm
        JOIN public.billing_courses bc ON bc.id = gm.billing_course_id
       WHERE gm.enrollment_id = NEW.id
         AND bc.program_id IS DISTINCT FROM NEW.program_id
    ) THEN
      RAISE EXCEPTION 'enrollments.program_id cannot change while grade_marks tie this enrolment to another school'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.course_graders g
        LEFT JOIN public.billing_courses bc ON bc.id = g.billing_course_id
       WHERE g.enrollment_id = NEW.id
         AND (
           g.program_id IS DISTINCT FROM NEW.program_id
           OR (g.billing_course_id IS NOT NULL AND bc.program_id IS DISTINCT FROM NEW.program_id)
         )
    ) THEN
      RAISE EXCEPTION 'enrollments.program_id cannot change while course_graders tie this enrolment to another school'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'course_design_templates' THEN
    IF NEW.program_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.course_outlines o
        JOIN public.billing_courses bc ON bc.id = o.billing_course_id
       WHERE o.template_id = NEW.id
         AND bc.program_id IS DISTINCT FROM NEW.program_id
    ) THEN
      RAISE EXCEPTION 'course_design_templates.program_id cannot change while an outline on another school still uses it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lms_program_move_guard()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lms_billing_course_program_move
  BEFORE UPDATE OF program_id ON public.billing_courses
  FOR EACH ROW
  WHEN (OLD.program_id IS DISTINCT FROM NEW.program_id)
  EXECUTE FUNCTION public.lms_program_move_guard();

CREATE TRIGGER lms_enrollment_program_move
  BEFORE UPDATE OF program_id ON public.enrollments
  FOR EACH ROW
  WHEN (OLD.program_id IS DISTINCT FROM NEW.program_id)
  EXECUTE FUNCTION public.lms_program_move_guard();

CREATE TRIGGER lms_template_program_move
  BEFORE UPDATE OF program_id ON public.course_design_templates
  FOR EACH ROW
  WHEN (OLD.program_id IS DISTINCT FROM NEW.program_id)
  EXECUTE FUNCTION public.lms_program_move_guard();

COMMENT ON FUNCTION public.lms_program_move_guard() IS
  'Rejects a program_id change on a billing course, enrolment, or template that would leave a grade mark, grader row, or school-specific outline in the wrong school. SECURITY DEFINER so grade_marks notes are not granted to authenticated. Does not change billing_courses, grades, or fee-item policies. Does not call has_schools_access.';


-- ============================================================
-- Verify (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT c.relname, c.relrowsecurity
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN (
--        'course_design_templates', 'course_outlines',
--        'course_graders', 'grade_marks')
--    ORDER BY c.relname;
--   -- expect 4 rows, relrowsecurity true
--
--   SELECT tablename FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN (
--        'course_design_templates', 'course_outlines',
--        'course_graders', 'grade_marks');
--   -- expect 0 rows
--
--   SELECT indexrelid::regclass, indnullsnotdistinct
--     FROM pg_index
--    WHERE indexrelid = 'public.course_graders_scope'::regclass;
--   -- expect indnullsnotdistinct true
--
--   -- billing_courses write policies must be unchanged (still finance / admin)
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'billing_courses'
--    ORDER BY policyname;
-- ============================================================

-- ============================================================
-- ROLLBACK (run by hand only if needed)
-- ------------------------------------------------------------
--   BEGIN;
--   DROP TRIGGER IF EXISTS lms_billing_course_program_move ON public.billing_courses;
--   DROP TRIGGER IF EXISTS lms_enrollment_program_move ON public.enrollments;
--   DROP TABLE IF EXISTS public.grade_marks;
--   DROP TABLE IF EXISTS public.course_graders;
--   DROP TABLE IF EXISTS public.course_outlines;
--   DROP TABLE IF EXISTS public.course_design_templates;
--   DROP FUNCTION IF EXISTS public.lms_program_move_guard();
--   DROP FUNCTION IF EXISTS public.grade_marks_same_program();
--   DROP FUNCTION IF EXISTS public.course_outlines_same_program();
--   DROP FUNCTION IF EXISTS public.course_graders_same_program();
--   COMMIT;
-- ============================================================
