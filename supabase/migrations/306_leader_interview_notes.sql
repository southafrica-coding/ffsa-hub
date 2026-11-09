-- ============================================================
-- FFSA Hub — Migration 306: leaders can write interview notes
-- ============================================================
-- application_staff_reviews was staff-only (migration 304): the guard
-- trigger and the insert/update policies require the signed-in person
-- to be program staff AND the assigned contact. A school leader can
-- read those reviews and can already write application_admin_notes,
-- but they have nowhere to record their own interview.
--
-- This lets the same people can_manage_program_applications accepts
-- (admins, named leaders, schools.manage / approve_applications /
-- manage_enrollments, and the program_leader role) insert and update
-- a review whose author is themselves. Assigned staff keep their own
-- row. One row per author, so a leader does not overwrite the staff
-- note. Nothing here changes application status or
-- application_responses.admin_notes. That column stays.
--
-- Apply by hand in the Supabase SQL editor. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_application_staff_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_program uuid;
  v_assigned uuid;
BEGIN
  SELECT program_id, assigned_staff_id
    INTO v_program, v_assigned
  FROM public.application_responses
  WHERE id = NEW.application_response_id;

  IF v_program IS NULL THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  NEW.program_id := v_program;

  IF NEW.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'you can only write your own review';
  END IF;

  -- Assigned staff, or a person who can manage this school's applications.
  -- The message still names assigned program staff: the RLS harness matches it.
  IF NOT (
    (
      v_assigned IS NOT DISTINCT FROM auth.uid()
      AND public.is_program_staff(v_program)
    )
    OR public.can_manage_program_applications(v_program)
  ) THEN
    RAISE EXCEPTION 'only the assigned program staff member or a school manager can review this application';
  END IF;

  IF public.program_applications_expired(v_program)
     AND NOT public.can_access_expired_applications() THEN
    RAISE EXCEPTION 'applications for this school are archived';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_application_staff_review() FROM PUBLIC, anon, authenticated;

-- The policy has to see the application even when the writer cannot SELECT
-- it. schools.manage_enrollments and a program_leader role can manage notes
-- without has_schools_access, and an inline EXISTS would be hidden by
-- application_responses RLS. This returns only a yes/no for the caller.
CREATE OR REPLACE FUNCTION public.application_review_write_allowed(
  response_id uuid,
  claimed_program_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.application_responses ar
    WHERE ar.id = response_id
      AND ar.program_id = claimed_program_id
      AND public.application_gate(ar.program_id, true)
      AND (
        (
          ar.assigned_staff_id = (SELECT auth.uid())
          AND public.is_program_staff(ar.program_id)
        )
        OR public.can_manage_program_applications(ar.program_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.application_review_write_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.application_review_write_allowed(uuid, uuid) TO authenticated, service_role;

COMMENT ON TABLE public.application_staff_reviews IS
  'Interview notes and an outcome, one row per author per application. Assigned program staff and anyone can_manage_program_applications accepts write their own row. Does not change application status. Leader scratch notes stay in application_admin_notes.';

-- Read: managers (including manage_enrollments and the program_leader role),
-- people with schools.view_applications, and the assigned staff member.
DROP POLICY IF EXISTS "Read application staff reviews" ON public.application_staff_reviews;
CREATE POLICY "Read application staff reviews"
  ON public.application_staff_reviews FOR SELECT
  USING (
    public.application_gate(
      program_id,
      public.can_manage_program_applications(program_id)
      OR public.has_permission_for('schools.view_applications', program_id)
      OR (
        author_id = (SELECT auth.uid())
        AND public.is_program_staff(program_id)
        AND EXISTS (
          SELECT 1
          FROM public.application_responses ar
          WHERE ar.id = application_response_id
            AND ar.assigned_staff_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Assigned program staff can insert their review" ON public.application_staff_reviews;
DROP POLICY IF EXISTS "Staff or managers insert their review" ON public.application_staff_reviews;
CREATE POLICY "Staff or managers insert their review"
  ON public.application_staff_reviews FOR INSERT
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.application_review_write_allowed(application_response_id, program_id)
  );

DROP POLICY IF EXISTS "Assigned program staff can update their review" ON public.application_staff_reviews;
DROP POLICY IF EXISTS "Staff or managers update their review" ON public.application_staff_reviews;
CREATE POLICY "Staff or managers update their review"
  ON public.application_staff_reviews FOR UPDATE
  USING (
    author_id = (SELECT auth.uid())
    AND public.application_review_write_allowed(application_response_id, program_id)
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.application_review_write_allowed(application_response_id, program_id)
  );
