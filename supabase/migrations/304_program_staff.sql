-- ============================================================
-- FFSA Hub — Migration 304: program staff
-- ============================================================
-- A school can name staff who are not leaders. Staff review only the
-- applicants assigned to them (notes + an interview outcome). They do
-- not edit the application form or the school's emails, and they do
-- not see student fees, payments, discounts, or other finance rows.
--
-- Stored as public.program_staff, a sibling of program_leaders
-- (migration 145), NOT a role column on that table and NOT a schools.*
-- permission. program_leaders membership IS has_schools_access, so a
-- role flag there would hand staff leader powers wherever a query
-- forgot to filter. schools.* grants are program-wide, not "this
-- applicant only", and six SBI people already hold those grants by
-- hand — this migration does not read or write program_leaders,
-- user_permissions, or user_roles.
--
-- Who may add or remove staff: the same set as has_schools_access
-- (migration 145), which is how the leader-team RLS is already gated:
--   • is_admin() — super_admin and admin
--   • has_permission_for('schools.manage', program)
--   • is_program_leader(program)
-- approve_applications and manage_enrollments are not enough.
--
-- Staff are assignable contacts for their own program. That is an
-- app-layer read of this table (fetchAssignableContacts), not a
-- schools.assignable_as_contact grant, so nothing is backfilled.
--
-- Idempotent. Safe to re-run. Does not change existing rows.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Membership
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.program_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, user_id)
);

CREATE INDEX IF NOT EXISTS program_staff_program_idx
  ON public.program_staff (program_id);
CREATE INDEX IF NOT EXISTS program_staff_user_idx
  ON public.program_staff (user_id);

COMMENT ON TABLE public.program_staff IS
  'Staff of one school. Not leaders: no has_schools_access. They review applicants assigned to them and can be assigned as that school''s contact. Add or remove via has_schools_access (leaders, schools.manage, admins).';

CREATE OR REPLACE FUNCTION public.is_program_staff(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.program_staff
    WHERE program_id = target_program_id
      AND user_id = auth.uid()
  );
$$;

-- True when this user is staff of the program and does not already
-- manage it. Leaders and schools.manage holders stay managers even if
-- someone also lists them as staff.
CREATE OR REPLACE FUNCTION public.program_staff_cannot_manage(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_program_staff(target_program_id)
     AND NOT public.has_schools_access(target_program_id);
$$;

-- True when staff-only eyes must not see this program's finance.
-- Anyone who already has leader, schools.*, admin, or finance access
-- is left alone — including the SBI grants this migration does not touch.
CREATE OR REPLACE FUNCTION public.program_staff_blocked_from_finance(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_program_staff(target_program_id)
     AND NOT public.has_schools_access(target_program_id)
     AND NOT public.has_role('finance_admin')
     AND NOT public.has_permission('finance.view')
     AND NOT public.has_permission('finance.manage')
     AND NOT public.has_permission('finance.write')
     AND NOT public.has_permission('finance.edit')
     AND NOT public.has_permission('budget.view_all')
     AND NOT public.has_permission_for('schools.manage', target_program_id)
     AND NOT public.has_permission_for('schools.view_applications', target_program_id)
     AND NOT public.has_permission_for('schools.approve_applications', target_program_id)
     AND NOT public.has_permission_for('schools.manage_enrollments', target_program_id)
     AND NOT public.has_permission_for('schools.manage_attendance', target_program_id)
     AND NOT public.has_permission_for('schools.assignable_as_contact', target_program_id);
$$;

REVOKE ALL ON FUNCTION public.is_program_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.program_staff_cannot_manage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.program_staff_blocked_from_finance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_program_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.program_staff_cannot_manage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.program_staff_blocked_from_finance(uuid) TO authenticated, service_role;

ALTER TABLE public.program_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read program staff" ON public.program_staff;
CREATE POLICY "Read program staff"
  ON public.program_staff FOR SELECT
  USING (
    public.has_schools_access(program_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Manage program staff" ON public.program_staff;
CREATE POLICY "Manage program staff"
  ON public.program_staff FOR ALL
  USING (public.has_schools_access(program_id))
  WITH CHECK (public.has_schools_access(program_id));

-- ────────────────────────────────────────────────────────────
-- 2. Interview notes. Separate from application_responses so a
--    staff UPDATE cannot change status, answers, or acceptance.
--    One row per assigned staff member per application.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_staff_reviews (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_response_id uuid NOT NULL REFERENCES public.application_responses(id) ON DELETE CASCADE,
  program_id              uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  author_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notes                   text,
  interview_outcome       text NOT NULL DEFAULT 'pending'
    CHECK (interview_outcome IN ('pending', 'recommend', 'hold', 'decline')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_response_id, author_id)
);

CREATE INDEX IF NOT EXISTS application_staff_reviews_response_idx
  ON public.application_staff_reviews (application_response_id);
CREATE INDEX IF NOT EXISTS application_staff_reviews_program_idx
  ON public.application_staff_reviews (program_id);
CREATE INDEX IF NOT EXISTS application_staff_reviews_author_idx
  ON public.application_staff_reviews (author_id);

COMMENT ON TABLE public.application_staff_reviews IS
  'Notes and interview outcome written by the program staff member assigned to an application. Does not change application status. Leaders read these; they keep using admin_notes and status for the decision.';

COMMENT ON COLUMN public.application_staff_reviews.interview_outcome IS
  'pending | recommend | hold | decline. A recommendation, not the application status.';

CREATE OR REPLACE FUNCTION public.touch_application_staff_reviews_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_staff_reviews_updated_at
  ON public.application_staff_reviews;
CREATE TRIGGER trg_application_staff_reviews_updated_at
  BEFORE UPDATE ON public.application_staff_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_application_staff_reviews_updated_at();

-- Forces program_id from the application and rejects writes that are
-- not the assigned program-staff member, including service-role writes
-- where auth.uid() is null. The API uses the user client on purpose.
CREATE OR REPLACE FUNCTION public.guard_application_staff_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF v_assigned IS DISTINCT FROM auth.uid()
     OR NOT public.is_program_staff(v_program) THEN
    RAISE EXCEPTION 'only the assigned program staff member can review this application';
  END IF;

  IF public.program_applications_expired(v_program)
     AND NOT public.can_access_expired_applications() THEN
    RAISE EXCEPTION 'applications for this school are archived';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_application_staff_review
  ON public.application_staff_reviews;
CREATE TRIGGER trg_guard_application_staff_review
  BEFORE INSERT OR UPDATE ON public.application_staff_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_staff_review();

REVOKE ALL ON FUNCTION public.guard_application_staff_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_application_staff_review() TO authenticated, service_role;

ALTER TABLE public.application_staff_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read application staff reviews" ON public.application_staff_reviews;
CREATE POLICY "Read application staff reviews"
  ON public.application_staff_reviews FOR SELECT
  USING (
    public.application_gate(
      program_id,
      public.has_schools_access(program_id)
      OR public.has_permission_for('schools.view_applications', program_id)
      OR public.has_permission_for('schools.approve_applications', program_id)
      OR (
        author_id = auth.uid()
        AND public.is_program_staff(program_id)
        AND EXISTS (
          SELECT 1
          FROM public.application_responses ar
          WHERE ar.id = application_response_id
            AND ar.assigned_staff_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Assigned program staff can insert their review" ON public.application_staff_reviews;
CREATE POLICY "Assigned program staff can insert their review"
  ON public.application_staff_reviews FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_program_staff(program_id)
    AND EXISTS (
      SELECT 1
      FROM public.application_responses ar
      WHERE ar.id = application_response_id
        AND ar.program_id = program_id
        AND ar.assigned_staff_id = auth.uid()
        AND public.application_gate(ar.program_id, true)
    )
  );

DROP POLICY IF EXISTS "Assigned program staff can update their review" ON public.application_staff_reviews;
CREATE POLICY "Assigned program staff can update their review"
  ON public.application_staff_reviews FOR UPDATE
  USING (
    author_id = auth.uid()
    AND public.is_program_staff(program_id)
    AND EXISTS (
      SELECT 1
      FROM public.application_responses ar
      WHERE ar.id = application_response_id
        AND ar.assigned_staff_id = auth.uid()
        AND public.application_gate(ar.program_id, true)
    )
  )
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_program_staff(program_id)
    AND EXISTS (
      SELECT 1
      FROM public.application_responses ar
      WHERE ar.id = application_response_id
        AND ar.program_id = program_id
        AND ar.assigned_staff_id = auth.uid()
        AND public.application_gate(ar.program_id, true)
    )
  );

-- No DELETE policy: reviews stay as the record of what was written.
-- Leaders do not get an UPDATE policy on application_responses from this
-- migration; their existing policies are unchanged. Staff do not gain one.

-- ────────────────────────────────────────────────────────────
-- 3. Form and email writes. Permissive policies already require
--    has_schools_access. These restrictive policies keep a future
--    broad policy from opening the form or the emails to staff who
--    do not manage the school. Leaders (has_schools_access) pass.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Program staff cannot edit application questions" ON public.application_questions;
CREATE POLICY "Program staff cannot edit application questions"
  ON public.application_questions
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot update application questions" ON public.application_questions;
CREATE POLICY "Program staff cannot update application questions"
  ON public.application_questions
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id))
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot delete application questions" ON public.application_questions;
CREATE POLICY "Program staff cannot delete application questions"
  ON public.application_questions
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot edit reference slots" ON public.reference_slots;
CREATE POLICY "Program staff cannot edit reference slots"
  ON public.reference_slots
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot update reference slots" ON public.reference_slots;
CREATE POLICY "Program staff cannot update reference slots"
  ON public.reference_slots
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id))
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot delete reference slots" ON public.reference_slots;
CREATE POLICY "Program staff cannot delete reference slots"
  ON public.reference_slots
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot edit reference questions" ON public.reference_questions;
CREATE POLICY "Program staff cannot edit reference questions"
  ON public.reference_questions
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot update reference questions" ON public.reference_questions;
CREATE POLICY "Program staff cannot update reference questions"
  ON public.reference_questions
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id))
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot delete reference questions" ON public.reference_questions;
CREATE POLICY "Program staff cannot delete reference questions"
  ON public.reference_questions
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot edit program emails" ON public.program_email_templates;
CREATE POLICY "Program staff cannot edit program emails"
  ON public.program_email_templates
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id))
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

DROP POLICY IF EXISTS "Program staff cannot edit program email documents" ON public.program_email_documents;
CREATE POLICY "Program staff cannot edit program email documents"
  ON public.program_email_documents
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(program_id))
  WITH CHECK (NOT public.program_staff_cannot_manage(program_id));

-- Acceptance email lives on programs. Staff cannot update the row.
DROP POLICY IF EXISTS "Program staff cannot edit program settings" ON public.programs;
CREATE POLICY "Program staff cannot edit program settings"
  ON public.programs
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.program_staff_cannot_manage(id))
  WITH CHECK (NOT public.program_staff_cannot_manage(id));

-- ────────────────────────────────────────────────────────────
-- 4. Finance. Restrictive, so it only removes rows from people
--    this migration is willing to call staff-only. A leader, a
--    schools.* grant, an admin, or a finance grant still matches
--    the existing permissive policies and passes these.
--    Own-student rows (user_id = auth.uid()) stay readable.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Program staff cannot read school fee structures" ON public.school_fee_structures;
CREATE POLICY "Program staff cannot read school fee structures"
  ON public.school_fee_structures
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (NOT public.program_staff_blocked_from_finance(program_id));

DROP POLICY IF EXISTS "Program staff cannot read student fees" ON public.student_fees;
CREATE POLICY "Program staff cannot read student fees"
  ON public.student_fees
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR NOT public.program_staff_blocked_from_finance(program_id)
  );

DROP POLICY IF EXISTS "Program staff cannot read student payments" ON public.student_payments;
CREATE POLICY "Program staff cannot read student payments"
  ON public.student_payments
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.student_fees sf
      WHERE sf.id = student_payments.student_fee_id
        AND (
          sf.user_id = auth.uid()
          OR NOT public.program_staff_blocked_from_finance(sf.program_id)
        )
    )
  );

DROP POLICY IF EXISTS "Program staff cannot read program charge items" ON public.program_charge_items;
CREATE POLICY "Program staff cannot read program charge items"
  ON public.program_charge_items
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (NOT public.program_staff_blocked_from_finance(program_id));

DROP POLICY IF EXISTS "Program staff cannot read billing schedules" ON public.billing_schedules;
CREATE POLICY "Program staff cannot read billing schedules"
  ON public.billing_schedules
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (NOT public.program_staff_blocked_from_finance(program_id));

DROP POLICY IF EXISTS "Program staff cannot read fee charge items" ON public.fee_charge_items;
CREATE POLICY "Program staff cannot read fee charge items"
  ON public.fee_charge_items
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1
      FROM public.billing_courses c
      WHERE c.id = fee_charge_items.course_id
        AND public.program_staff_blocked_from_finance(c.program_id)
    )
  );

DROP POLICY IF EXISTS "Program staff cannot read billing plans" ON public.student_billing_plans;
CREATE POLICY "Program staff cannot read billing plans"
  ON public.student_billing_plans
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR NOT public.program_staff_blocked_from_finance(program_id)
  );

DROP POLICY IF EXISTS "Program staff cannot read billing schedule rows" ON public.student_billing_schedule;
CREATE POLICY "Program staff cannot read billing schedule rows"
  ON public.student_billing_schedule
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.student_billing_plans p
      WHERE p.id = student_billing_schedule.plan_id
        AND (
          p.user_id = auth.uid()
          OR NOT public.program_staff_blocked_from_finance(p.program_id)
        )
    )
  );

-- ============================================================
-- Validation (do not run the switch here)
-- ------------------------------------------------------------
--   SELECT public.is_program_staff('<program uuid>');
--   SELECT policyname, cmd, permissive
--     FROM pg_policies
--    WHERE tablename IN (
--      'program_staff', 'application_staff_reviews',
--      'school_fee_structures', 'student_fees', 'student_payments'
--    );
-- Switching a person off leader / schools.* grants is a separate,
-- reviewed step. See docs/program-staff.md. This file does not do it.
-- ============================================================
