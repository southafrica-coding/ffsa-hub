-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 310: schools LMS assignments (slice 2)
-- ============================================================
-- Not applied to prod or any shared Supabase project. Previews share the
-- prod database, so do not run this anywhere until Jack says so.
--
-- Assignments, student submissions (one row per attempt), files on an
-- attempt, and one grade per attempt. Builds on 305 (lms_courses /
-- lms_modules / lms_lessons and its helpers) and 304 (program_staff,
-- is_program_staff). Does not read or write billing_courses, grades,
-- grade_marks, the fee tables, or the legacy public.courses table.
--
-- 310 also redefines 305's lms_can_edit so a program_leader ROLE only
-- counts for the program it is scoped to (it used to count for every
-- program via can_manage_program_applications). See section 2.
--
-- Who can do what:
--   • Editors — lms_can_edit(program) — create / edit / publish /
--     delete assignments, read every submitted attempt and file in the
--     school, grade and release grades, delete assignments nobody has submitted to.
--   • Program staff — is_program_staff(program) — read published
--     assignments, read every submitted attempt and file in the school,
--     write grades and released_at. They cannot edit assignments.
--   • Enrolled students — lms_is_enrolled(program) — read published
--     assignments in published courses; create a new attempt on their
--     own enrolment; edit or delete only their own draft attempt and its
--     files; read all their own attempts; read a grade only once
--     released_at is set. Never write grades.
--   • anon: no grants.
--
-- Attempts:
--   • A trigger sets attempt_no = max + 1, submitted_at, and is_late.
--     Client values for those columns are ignored.
--   • allow_late = false and now() > due_at: submitting raises
--     'late_not_allowed' (the API returns 409 first).
--   • A submitted attempt is immutable for everyone and is never deleted,
--     not even by an assignment / course cascade (23503). Its files cannot
--     be added or removed. Its grade is frozen once a later attempt is
--     submitted (releasing a still-unreleased grade stays allowed).
--   • Submitting needs at least one piece of content of an accepted type
--     ('empty_submission').
--   • Nobody grades their own attempt.
--   • created_at (all tables) and created_by (assignments) are stamped by
--     trigger; client values are ignored.
--   • The latest submitted attempt (highest attempt_no) is current:
--     view lms_current_submissions, security_invoker.
--
-- Keeping student work:
--   • lms_submissions.enrollment_id → enrollments ON DELETE RESTRICT.
--   • lms_grades.submission_id → lms_submissions ON DELETE RESTRICT, and
--     the delete guard refuses any submitted attempt, so deleting an
--     assignment (or its course) that has submitted work fails with 23503.
--     The API checks first and answers 409; 23503 → 409 is the backstop.
--
-- Storage: private bucket 'lms-submissions'. Object path
--   {program_id}/{assignment_id}/{submission_id}/{random_uuid}.{ext}
-- No user id or email in the path. Reads are served as ≤5-minute signed
-- URLs minted server-side after an auth check; the storage.objects
-- policies below mirror the submission RLS as a second gate.
--
-- No new permission keys. Idempotent. Safe to re-run.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lms_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id         uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  title             text NOT NULL CHECK (length(btrim(title)) > 0),
  instructions      text,
  due_at            timestamptz,
  allow_late        boolean NOT NULL DEFAULT true,
  submission_types  text[] NOT NULL DEFAULT ARRAY['text']::text[],
  max_points        numeric NOT NULL CHECK (max_points > 0),
  published         boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lms_assignments_types_check CHECK (
    cardinality(submission_types) > 0
    AND submission_types <@ ARRAY['text', 'link', 'file']::text[]
  )
);

CREATE TABLE IF NOT EXISTS public.lms_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES public.lms_assignments(id) ON DELETE CASCADE,
  enrollment_id  uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE RESTRICT,
  attempt_no     int  NOT NULL,
  body_text      text,
  link_url       text CHECK (link_url IS NULL OR link_url ~* '^https?://'),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at   timestamptz,
  is_late        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lms_submissions_attempt_unique UNIQUE (assignment_id, enrollment_id, attempt_no),
  CONSTRAINT lms_submissions_submitted_at_check CHECK (
    (status = 'draft' AND submitted_at IS NULL)
    OR (status = 'submitted' AND submitted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.lms_submission_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES public.lms_submissions(id) ON DELETE CASCADE,
  storage_path   text NOT NULL UNIQUE,
  file_name      text NOT NULL CHECK (length(btrim(file_name)) > 0 AND length(file_name) <= 255),
  mime           text NOT NULL CHECK (mime IN (
                   'application/pdf',
                   'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
                   'application/msword',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                   'application/vnd.ms-powerpoint',
                   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                   'text/plain'
                 )),
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_grades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL UNIQUE REFERENCES public.lms_submissions(id) ON DELETE RESTRICT,
  points         numeric NOT NULL,
  feedback       text,
  graded_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  graded_at      timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  released_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- At most one draft per student per assignment.
CREATE UNIQUE INDEX IF NOT EXISTS lms_submissions_one_draft_idx
  ON public.lms_submissions (assignment_id, enrollment_id)
  WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS lms_assignments_course_idx ON public.lms_assignments (course_id);
CREATE INDEX IF NOT EXISTS lms_assignments_lesson_idx ON public.lms_assignments (lesson_id);
CREATE INDEX IF NOT EXISTS lms_assignments_created_by_idx ON public.lms_assignments (created_by);
-- (assignment_id, enrollment_id, attempt_no) unique index serves assignment_id.
CREATE INDEX IF NOT EXISTS lms_submissions_enrollment_idx ON public.lms_submissions (enrollment_id);
CREATE INDEX IF NOT EXISTS lms_submission_files_submission_idx ON public.lms_submission_files (submission_id);
-- submission_id UNIQUE serves the FK on lms_grades.
CREATE INDEX IF NOT EXISTS lms_grades_graded_by_idx ON public.lms_grades (graded_by);
CREATE INDEX IF NOT EXISTS lms_grades_released_by_idx ON public.lms_grades (released_by);

COMMENT ON TABLE public.lms_assignments IS
  'Classroom assignment on an lms_courses row (LMS slice 2). Optional lesson_id. Not billing_courses.';
COMMENT ON TABLE public.lms_submissions IS
  'One row per attempt. Submitted rows are immutable; the highest submitted attempt_no is current.';
COMMENT ON TABLE public.lms_submission_files IS
  'File on a draft attempt, stored in the private lms-submissions bucket.';
COMMENT ON TABLE public.lms_grades IS
  'One grade per attempt. Students see it only once released_at is set.';

DROP TRIGGER IF EXISTS set_updated_at ON public.lms_assignments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lms_submissions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_submissions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lms_submission_files;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_submission_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lms_grades;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_grades
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. Access helpers
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can walk assignment → course → program
-- without recursing through RLS. All of them only answer yes / no (or a
-- program id) for the caller's own auth.uid().

-- F1: redefine 305's lms_can_edit with the program_leader role scoped to
-- this program. 305 called can_manage_program_applications, whose last
-- branch (304) accepts a program_leader role held for ANY program, so a
-- leader of one school could edit another school's classroom — and with
-- this migration, grade it. Same branches otherwise. This also closes that
-- leak for 305's course / module / lesson policies, on purpose.
-- NOTE: can_manage_program_applications itself still has the unscoped
-- program_leader branch (applications); fixing it is out of scope here.
CREATE OR REPLACE FUNCTION public.lms_can_edit(target_program_id uuid)
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
           AND (ur.scope_type IS NULL
                OR (ur.scope_type = 'program' AND ur.scope_id = target_program_id))
      );
$$;
REVOKE ALL ON FUNCTION public.lms_can_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lms_can_edit(uuid) TO authenticated, service_role;

-- Graders: editors and program staff.
CREATE OR REPLACE FUNCTION public.lms_can_grade(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.lms_can_edit(target_program_id)
      OR public.is_program_staff(target_program_id);
$$;

CREATE OR REPLACE FUNCTION public.lms_assignment_program(target_assignment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.program_id
    FROM public.lms_assignments a
    JOIN public.lms_courses c ON c.id = a.course_id
   WHERE a.id = target_assignment_id;
$$;

-- Student-visible: assignment and its course published, caller enrolled.
CREATE OR REPLACE FUNCTION public.lms_assignment_student_visible(target_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_assignments a
      JOIN public.lms_courses c ON c.id = a.course_id
     WHERE a.id = target_assignment_id
       AND a.published
       AND c.published
       AND public.lms_is_enrolled(c.program_id)
  );
$$;

-- The caller's own, still-active enrolment in the assignment's school.
CREATE OR REPLACE FUNCTION public.lms_enrollment_is_mine_for(target_enrollment_id uuid, target_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.enrollments e
     WHERE e.id = target_enrollment_id
       AND e.user_id = auth.uid()
       AND e.removed_at IS NULL
       AND e.status NOT IN ('dismissed', 'decided_to_leave')
       AND e.program_id = public.lms_assignment_program(target_assignment_id)
  );
$$;

-- The caller owns this enrolment (any status, so a graduated or removed
-- student keeps read access to their own work). Policies on
-- lms_submissions use this on the row's own column rather than looking the
-- submission up by id, so INSERT ... RETURNING passes the SELECT policy.
CREATE OR REPLACE FUNCTION public.lms_enrollment_is_mine(target_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments e
     WHERE e.id = target_enrollment_id
       AND e.user_id = auth.uid()
  );
$$;

-- The caller owns this attempt (by enrolment; any enrolment status, so a
-- graduated student keeps read access to their own work).
CREATE OR REPLACE FUNCTION public.lms_submission_is_mine(target_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_submissions s
      JOIN public.enrollments e ON e.id = s.enrollment_id
     WHERE s.id = target_submission_id
       AND e.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.lms_submission_is_my_draft(target_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_submissions s
      JOIN public.enrollments e ON e.id = s.enrollment_id
     WHERE s.id = target_submission_id
       AND s.status = 'draft'
       AND e.user_id = auth.uid()
  );
$$;

-- A grader of this school may see this attempt (submitted only; drafts
-- stay private to the student).
CREATE OR REPLACE FUNCTION public.lms_submission_gradeable(target_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_submissions s
     WHERE s.id = target_submission_id
       AND s.status = 'submitted'
       AND public.lms_can_grade(public.lms_assignment_program(s.assignment_id))
  );
$$;

-- Storage: object name → may the caller read it / write it?
CREATE OR REPLACE FUNCTION public.lms_storage_object_readable(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_submission_files f
     WHERE f.storage_path = object_name
       AND (public.lms_submission_gradeable(f.submission_id)
            OR public.lms_submission_is_mine(f.submission_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.lms_storage_object_writable(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_submission_files f
     WHERE f.storage_path = object_name
       AND public.lms_submission_is_my_draft(f.submission_id)
  );
$$;

-- Grading roster: every classroom student in the school, with display
-- names. Staff cannot read enrollments or users rows for students not
-- assigned to them (304), so this returns only what grading needs, and
-- only to graders of that school. Everyone else gets no rows.
CREATE OR REPLACE FUNCTION public.lms_grading_roster(target_program_id uuid)
RETURNS TABLE (
  enrollment_id  uuid,
  first_name     text,
  last_name      text,
  preferred_name text,
  status         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.id, u.first_name, u.last_name, u.preferred_name, e.status
    FROM public.enrollments e
    LEFT JOIN public.users u ON u.id = e.user_id
   WHERE e.program_id = target_program_id
     AND e.removed_at IS NULL
     AND e.status NOT IN ('dismissed', 'decided_to_leave')
     AND public.lms_can_grade(target_program_id)
   ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, e.id;
$$;

REVOKE ALL ON FUNCTION public.lms_can_grade(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_assignment_program(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_assignment_student_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_enrollment_is_mine_for(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_enrollment_is_mine(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_submission_is_mine(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_submission_is_my_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_submission_gradeable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_storage_object_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_storage_object_writable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_grading_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lms_can_grade(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_assignment_program(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_assignment_student_visible(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_enrollment_is_mine_for(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_enrollment_is_mine(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_submission_is_mine(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_submission_is_my_draft(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_submission_gradeable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_storage_object_readable(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_storage_object_writable(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_grading_roster(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Integrity triggers
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read rows the caller's RLS hides (other
-- attempts' numbers, the assignment's due date, existing grades). They
-- never widen what the caller may write: RLS has already decided that.

-- Assignments: the lesson must sit in the same course; course_id is
-- fixed after insert; max_points cannot drop below a recorded grade.
CREATE OR REPLACE FUNCTION public.lms_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  top_points numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    RAISE EXCEPTION 'An assignment cannot move to another course'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lesson_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.lms_lessons l
      JOIN public.lms_modules m ON m.id = l.module_id
     WHERE l.id = NEW.lesson_id
       AND m.course_id = NEW.course_id
  ) THEN
    RAISE EXCEPTION 'The lesson must belong to the assignment''s course'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.max_points < OLD.max_points THEN
    SELECT max(g.points) INTO top_points
      FROM public.lms_grades g
      JOIN public.lms_submissions s ON s.id = g.submission_id
     WHERE s.assignment_id = NEW.id;
    IF top_points IS NOT NULL AND top_points > NEW.max_points THEN
      RAISE EXCEPTION 'max_points cannot be lower than an existing grade (%)', top_points
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_assignments_guard ON public.lms_assignments;
CREATE TRIGGER lms_assignments_guard
  BEFORE INSERT OR UPDATE ON public.lms_assignments
  FOR EACH ROW EXECUTE FUNCTION public.lms_assignments_guard();

-- Submissions: attempt numbering, the late rule, immutability.
CREATE OR REPLACE FUNCTION public.lms_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a_due      timestamptz;
  a_late_ok  boolean;
  a_program  uuid;
  e_program  uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'submitted' THEN
      RAISE EXCEPTION 'A submitted attempt cannot be changed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
       OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no THEN
      RAISE EXCEPTION 'assignment_id, enrollment_id and attempt_no are fixed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT a.due_at, a.allow_late, c.program_id
    INTO a_due, a_late_ok, a_program
    FROM public.lms_assignments a
    JOIN public.lms_courses c ON c.id = a.course_id
   WHERE a.id = NEW.assignment_id;

  IF TG_OP = 'INSERT' THEN
    SELECT e.program_id INTO e_program
      FROM public.enrollments e WHERE e.id = NEW.enrollment_id;
    IF e_program IS DISTINCT FROM a_program THEN
      RAISE EXCEPTION 'The enrolment is not in this assignment''s school'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Serialise attempts for one student on one assignment.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.assignment_id::text || ':' || NEW.enrollment_id::text, 0)
    );

    IF EXISTS (
      SELECT 1 FROM public.lms_submissions s
       WHERE s.assignment_id = NEW.assignment_id
         AND s.enrollment_id = NEW.enrollment_id
         AND s.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'draft_exists: finish or delete the open draft first'
        USING ERRCODE = 'unique_violation';
    END IF;

    SELECT coalesce(max(s.attempt_no), 0) + 1 INTO NEW.attempt_no
      FROM public.lms_submissions s
     WHERE s.assignment_id = NEW.assignment_id
       AND s.enrollment_id = NEW.enrollment_id;
  END IF;

  IF NEW.status = 'submitted' THEN
    IF a_due IS NOT NULL AND now() > a_due AND NOT a_late_ok THEN
      RAISE EXCEPTION 'late_not_allowed'
        USING ERRCODE = 'check_violation',
              DETAIL = 'This assignment does not accept work after its due date.';
    END IF;
    NEW.submitted_at := now();
    NEW.is_late := (a_due IS NOT NULL AND now() > a_due);
  ELSE
    NEW.submitted_at := NULL;
    NEW.is_late := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_submissions_guard ON public.lms_submissions;
CREATE TRIGGER lms_submissions_guard
  BEFORE INSERT OR UPDATE ON public.lms_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lms_submissions_guard();

-- F2: a submitted attempt is never deleted, at any depth. Drafts still go
-- (directly, or by cascade from their assignment / course). A cascade from
-- a deleted assignment or course that reaches a submitted attempt raises
-- 23503 so the API's RESTRICT → 409 mapping applies; a direct delete
-- raises check_violation.
CREATE OR REPLACE FUNCTION public.lms_submissions_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'This assignment has submitted student work and cannot be deleted'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RAISE EXCEPTION 'A submitted attempt cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS lms_submissions_delete_guard ON public.lms_submissions;
CREATE TRIGGER lms_submissions_delete_guard
  BEFORE DELETE ON public.lms_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lms_submissions_delete_guard();

-- Files: only on a draft attempt, at most 10 per attempt, path must sit
-- under {program}/{assignment}/{submission}/.
CREATE OR REPLACE FUNCTION public.lms_submission_files_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s_status     text;
  s_assignment uuid;
  s_program    uuid;
  file_count   int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Submission files cannot be changed; delete and re-upload'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Cascade from a deleted draft or assignment is fine.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    SELECT s.status INTO s_status FROM public.lms_submissions s WHERE s.id = OLD.submission_id;
    IF s_status = 'submitted' THEN
      RAISE EXCEPTION 'Files on a submitted attempt cannot be removed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT s.status, s.assignment_id INTO s_status, s_assignment
    FROM public.lms_submissions s WHERE s.id = NEW.submission_id
    FOR UPDATE;
  IF s_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Files can only be added to a draft attempt'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO file_count
    FROM public.lms_submission_files f WHERE f.submission_id = NEW.submission_id;
  IF file_count >= 10 THEN
    RAISE EXCEPTION 'An attempt can hold at most 10 files'
      USING ERRCODE = 'check_violation';
  END IF;

  s_program := public.lms_assignment_program(s_assignment);
  IF NEW.storage_path !~ (
       '^' || s_program::text || '/' || s_assignment::text || '/' || NEW.submission_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$'
     ) THEN
    RAISE EXCEPTION 'storage_path must be {program}/{assignment}/{submission}/{uuid}.{ext}'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_submission_files_guard ON public.lms_submission_files;
CREATE TRIGGER lms_submission_files_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.lms_submission_files
  FOR EACH ROW EXECUTE FUNCTION public.lms_submission_files_guard();

-- Grades: points within 0..max_points, submitted attempts only,
-- graded_by / graded_at / released_by stamped here, and a superseded
-- attempt's grade frozen (releasing a held grade is still allowed).
CREATE OR REPLACE FUNCTION public.lms_grades_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s_status     text;
  s_assignment uuid;
  s_enrollment uuid;
  s_attempt    int;
  a_max        numeric;
  superseded   boolean;
  release_only boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'A grade cannot move to another attempt'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.status, s.assignment_id, s.enrollment_id, s.attempt_no, a.max_points
    INTO s_status, s_assignment, s_enrollment, s_attempt, a_max
    FROM public.lms_submissions s
    JOIN public.lms_assignments a ON a.id = s.assignment_id
   WHERE s.id = coalesce(NEW.submission_id, OLD.submission_id);

  superseded := EXISTS (
    SELECT 1 FROM public.lms_submissions s2
     WHERE s2.assignment_id = s_assignment
       AND s2.enrollment_id = s_enrollment
       AND s2.status = 'submitted'
       AND s2.attempt_no > s_attempt
  );

  IF TG_OP = 'DELETE' THEN
    IF superseded THEN
      RAISE EXCEPTION 'A grade on an earlier attempt cannot be removed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF s_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted attempt can be graded'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.points IS NULL OR NEW.points < 0 OR NEW.points > a_max THEN
    RAISE EXCEPTION 'points must be between 0 and % for this assignment', a_max
      USING ERRCODE = 'check_violation';
  END IF;

  release_only := TG_OP = 'UPDATE'
    AND NEW.points = OLD.points
    AND NEW.feedback IS NOT DISTINCT FROM OLD.feedback
    AND OLD.released_at IS NULL
    AND NEW.released_at IS NOT NULL;

  IF superseded AND (TG_OP = 'INSERT' OR NOT release_only) THEN
    RAISE EXCEPTION 'A later attempt exists; this attempt''s grade is frozen'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.points IS DISTINCT FROM OLD.points
     OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
    NEW.graded_by := coalesce(auth.uid(), NEW.graded_by);
    NEW.graded_at := now();
  ELSE
    NEW.graded_by := OLD.graded_by;
    NEW.graded_at := OLD.graded_at;
  END IF;

  IF NEW.released_at IS NULL THEN
    NEW.released_by := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.released_at IS NULL THEN
    NEW.released_at := now();
    NEW.released_by := coalesce(auth.uid(), NEW.released_by);
  ELSE
    NEW.released_at := OLD.released_at;
    NEW.released_by := OLD.released_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_grades_guard ON public.lms_grades;
CREATE TRIGGER lms_grades_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.lms_grades
  FOR EACH ROW EXECUTE FUNCTION public.lms_grades_guard();

-- F4: created_at (all four tables) and created_by (assignments) are set
-- here, not by the client. On UPDATE they are frozen. updated_at on UPDATE
-- stays with handle_updated_at.
CREATE OR REPLACE FUNCTION public.lms_stamp_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
    IF TG_TABLE_NAME = 'lms_assignments' AND auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    IF TG_TABLE_NAME = 'lms_assignments' THEN
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_stamp_created ON public.lms_assignments;
CREATE TRIGGER lms_stamp_created
  BEFORE INSERT OR UPDATE ON public.lms_assignments
  FOR EACH ROW EXECUTE FUNCTION public.lms_stamp_created();
DROP TRIGGER IF EXISTS lms_stamp_created ON public.lms_submissions;
CREATE TRIGGER lms_stamp_created
  BEFORE INSERT OR UPDATE ON public.lms_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lms_stamp_created();
DROP TRIGGER IF EXISTS lms_stamp_created ON public.lms_submission_files;
CREATE TRIGGER lms_stamp_created
  BEFORE INSERT OR UPDATE ON public.lms_submission_files
  FOR EACH ROW EXECUTE FUNCTION public.lms_stamp_created();
DROP TRIGGER IF EXISTS lms_stamp_created ON public.lms_grades;
CREATE TRIGGER lms_stamp_created
  BEFORE INSERT OR UPDATE ON public.lms_grades
  FOR EACH ROW EXECUTE FUNCTION public.lms_stamp_created();

-- F5: an attempt that becomes submitted must carry at least one piece of
-- content of a type the assignment accepts (text / link / file). Extra
-- content of other types is allowed. Files must already be on the draft.
CREATE OR REPLACE FUNCTION public.lms_submissions_content_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a_types text[];
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW; -- lms_submissions_guard refuses the change
  END IF;

  SELECT a.submission_types INTO a_types
    FROM public.lms_assignments a WHERE a.id = NEW.assignment_id;

  IF NOT (
       ('text' = ANY (a_types) AND NEW.body_text IS NOT NULL AND length(btrim(NEW.body_text)) > 0)
    OR ('link' = ANY (a_types) AND NEW.link_url IS NOT NULL)
    OR ('file' = ANY (a_types) AND TG_OP = 'UPDATE' AND EXISTS (
          SELECT 1 FROM public.lms_submission_files f WHERE f.submission_id = NEW.id))
  ) THEN
    RAISE EXCEPTION 'empty_submission: hand in at least one of %', array_to_string(a_types, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lms_submissions_content_guard ON public.lms_submissions;
CREATE TRIGGER lms_submissions_content_guard
  BEFORE INSERT OR UPDATE ON public.lms_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lms_submissions_content_guard();

-- Trigger functions are not callable directly.
REVOKE ALL ON FUNCTION public.lms_assignments_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_submissions_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_submissions_delete_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_submission_files_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_grades_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_stamp_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_submissions_content_guard() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. Current attempt view
-- ────────────────────────────────────────────────────────────
-- Latest submitted attempt per student per assignment. security_invoker,
-- so the caller's RLS on lms_submissions applies.
CREATE OR REPLACE VIEW public.lms_current_submissions
WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.assignment_id, s.enrollment_id) s.*
  FROM public.lms_submissions s
 WHERE s.status = 'submitted'
 ORDER BY s.assignment_id, s.enrollment_id, s.attempt_no DESC;

-- ────────────────────────────────────────────────────────────
-- 5. Grants
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON public.lms_assignments FROM anon;
REVOKE ALL ON public.lms_submissions FROM anon;
REVOKE ALL ON public.lms_submission_files FROM anon;
REVOKE ALL ON public.lms_grades FROM anon;
REVOKE ALL ON public.lms_current_submissions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_submissions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.lms_submission_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_grades TO authenticated;
GRANT SELECT ON public.lms_current_submissions TO authenticated;
-- Supabase's default privileges hand authenticated everything on new
-- tables; take back what no policy needs.
REVOKE UPDATE ON public.lms_submission_files FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON
  public.lms_assignments, public.lms_submissions, public.lms_submission_files, public.lms_grades
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.lms_current_submissions FROM authenticated;

GRANT ALL ON public.lms_assignments TO service_role;
GRANT ALL ON public.lms_submissions TO service_role;
GRANT ALL ON public.lms_submission_files TO service_role;
GRANT ALL ON public.lms_grades TO service_role;
GRANT SELECT ON public.lms_current_submissions TO service_role;

-- ────────────────────────────────────────────────────────────
-- 6. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.lms_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_grades ENABLE ROW LEVEL SECURITY;

-- Assignments
DROP POLICY IF EXISTS "LMS assignments: editors all, staff and students published" ON public.lms_assignments;
CREATE POLICY "LMS assignments: editors all, staff and students published"
  ON public.lms_assignments FOR SELECT TO authenticated
  USING (
    public.lms_course_editable(course_id)
    OR (published AND public.lms_course_published_readable(course_id))
  );

DROP POLICY IF EXISTS "LMS assignments: editors insert" ON public.lms_assignments;
CREATE POLICY "LMS assignments: editors insert"
  ON public.lms_assignments FOR INSERT TO authenticated
  WITH CHECK (public.lms_course_editable(course_id));

DROP POLICY IF EXISTS "LMS assignments: editors update" ON public.lms_assignments;
CREATE POLICY "LMS assignments: editors update"
  ON public.lms_assignments FOR UPDATE TO authenticated
  USING (public.lms_course_editable(course_id))
  WITH CHECK (public.lms_course_editable(course_id));

DROP POLICY IF EXISTS "LMS assignments: editors delete" ON public.lms_assignments;
CREATE POLICY "LMS assignments: editors delete"
  ON public.lms_assignments FOR DELETE TO authenticated
  USING (public.lms_course_editable(course_id));

-- Submissions
DROP POLICY IF EXISTS "LMS submissions: graders read submitted, students read own" ON public.lms_submissions;
CREATE POLICY "LMS submissions: graders read submitted, students read own"
  ON public.lms_submissions FOR SELECT TO authenticated
  USING (
    (status = 'submitted' AND public.lms_can_grade(public.lms_assignment_program(assignment_id)))
    OR public.lms_enrollment_is_mine(enrollment_id)
  );

DROP POLICY IF EXISTS "LMS submissions: students insert own attempt" ON public.lms_submissions;
CREATE POLICY "LMS submissions: students insert own attempt"
  ON public.lms_submissions FOR INSERT TO authenticated
  WITH CHECK (
    public.lms_enrollment_is_mine_for(enrollment_id, assignment_id)
    AND public.lms_assignment_student_visible(assignment_id)
  );

-- A draft can be edited or turned into a submitted attempt by its owner.
-- The guard trigger refuses any change to a submitted row.
DROP POLICY IF EXISTS "LMS submissions: students update own draft" ON public.lms_submissions;
CREATE POLICY "LMS submissions: students update own draft"
  ON public.lms_submissions FOR UPDATE TO authenticated
  USING (
    status = 'draft'
    AND public.lms_enrollment_is_mine_for(enrollment_id, assignment_id)
    AND public.lms_assignment_student_visible(assignment_id)
  )
  WITH CHECK (
    public.lms_enrollment_is_mine_for(enrollment_id, assignment_id)
    AND public.lms_assignment_student_visible(assignment_id)
  );

DROP POLICY IF EXISTS "LMS submissions: students delete own draft" ON public.lms_submissions;
CREATE POLICY "LMS submissions: students delete own draft"
  ON public.lms_submissions FOR DELETE TO authenticated
  USING (status = 'draft' AND public.lms_enrollment_is_mine(enrollment_id));

-- Submission files
DROP POLICY IF EXISTS "LMS submission files: graders and owner read" ON public.lms_submission_files;
CREATE POLICY "LMS submission files: graders and owner read"
  ON public.lms_submission_files FOR SELECT TO authenticated
  USING (
    public.lms_submission_gradeable(submission_id)
    OR public.lms_submission_is_mine(submission_id)
  );

DROP POLICY IF EXISTS "LMS submission files: owner adds to draft" ON public.lms_submission_files;
CREATE POLICY "LMS submission files: owner adds to draft"
  ON public.lms_submission_files FOR INSERT TO authenticated
  WITH CHECK (public.lms_submission_is_my_draft(submission_id));

DROP POLICY IF EXISTS "LMS submission files: owner removes from draft" ON public.lms_submission_files;
CREATE POLICY "LMS submission files: owner removes from draft"
  ON public.lms_submission_files FOR DELETE TO authenticated
  USING (public.lms_submission_is_my_draft(submission_id));

-- Grades
DROP POLICY IF EXISTS "LMS grades: graders read, students read released own" ON public.lms_grades;
CREATE POLICY "LMS grades: graders read, students read released own"
  ON public.lms_grades FOR SELECT TO authenticated
  USING (
    public.lms_submission_gradeable(submission_id)
    OR (released_at IS NOT NULL AND public.lms_submission_is_mine(submission_id))
  );

-- F3: nobody grades their own attempt (a leader or staff member who is
-- also enrolled in the school).
DROP POLICY IF EXISTS "LMS grades: graders insert" ON public.lms_grades;
CREATE POLICY "LMS grades: graders insert"
  ON public.lms_grades FOR INSERT TO authenticated
  WITH CHECK (
    public.lms_submission_gradeable(submission_id)
    AND NOT public.lms_submission_is_mine(submission_id)
  );

DROP POLICY IF EXISTS "LMS grades: graders update" ON public.lms_grades;
CREATE POLICY "LMS grades: graders update"
  ON public.lms_grades FOR UPDATE TO authenticated
  USING (
    public.lms_submission_gradeable(submission_id)
    AND NOT public.lms_submission_is_mine(submission_id)
  )
  WITH CHECK (
    public.lms_submission_gradeable(submission_id)
    AND NOT public.lms_submission_is_mine(submission_id)
  );

-- Only editors may remove a grade outright (staff re-grade instead).
DROP POLICY IF EXISTS "LMS grades: editors delete" ON public.lms_grades;
CREATE POLICY "LMS grades: editors delete"
  ON public.lms_grades FOR DELETE TO authenticated
  USING (
    NOT public.lms_submission_is_mine(submission_id)
    AND EXISTS (
      SELECT 1 FROM public.lms_submissions s
       WHERE s.id = submission_id
         AND public.lms_can_edit(public.lms_assignment_program(s.assignment_id))
    )
  );

-- ────────────────────────────────────────────────────────────
-- 7. Storage: private bucket + object policies
-- ────────────────────────────────────────────────────────────
-- 20 MB per object; same mime allowlist as lms_submission_files.mime.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lms-submissions',
  'lms-submissions',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The app signs URLs with the service role after its own check; these
-- policies are the second gate for any direct storage call. An object is
-- reachable only when an lms_submission_files row names its exact path.
DROP POLICY IF EXISTS "LMS submissions bucket: graders and owner read" ON storage.objects;
CREATE POLICY "LMS submissions bucket: graders and owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lms-submissions' AND public.lms_storage_object_readable(name));

DROP POLICY IF EXISTS "LMS submissions bucket: owner uploads to draft" ON storage.objects;
CREATE POLICY "LMS submissions bucket: owner uploads to draft"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lms-submissions' AND public.lms_storage_object_writable(name));

DROP POLICY IF EXISTS "LMS submissions bucket: owner removes from draft" ON storage.objects;
CREATE POLICY "LMS submissions bucket: owner removes from draft"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lms-submissions' AND public.lms_storage_object_writable(name));

-- No UPDATE policy: objects are never overwritten in place.

-- ────────────────────────────────────────────────────────────
-- Verify after applying:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename LIKE 'lms_%' OR policyname LIKE 'LMS submissions bucket%';
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'lms-submissions';
-- ============================================================
