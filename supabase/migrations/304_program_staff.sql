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
--
-- CASE stops at the first match, so someone with no program_staff row
-- (the common case) does one indexed lookup on program_staff(user_id)
-- and never touches the permission tables. STABLE so the planner can
-- reuse the result within a statement.
CREATE OR REPLACE FUNCTION public.program_staff_blocked_from_finance(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.program_staff WHERE user_id = auth.uid()
    ) THEN false
    WHEN NOT public.is_program_staff(target_program_id) THEN false
    WHEN public.has_schools_access(target_program_id) THEN false
    WHEN public.has_role('finance_admin') THEN false
    WHEN public.has_permission('finance.view') THEN false
    WHEN public.has_permission('finance.manage') THEN false
    WHEN public.has_permission('finance.write') THEN false
    WHEN public.has_permission('finance.edit') THEN false
    WHEN public.has_permission('budget.view_all') THEN false
    WHEN public.has_permission_for('schools.manage', target_program_id) THEN false
    WHEN public.has_permission_for('schools.view_applications', target_program_id) THEN false
    WHEN public.has_permission_for('schools.approve_applications', target_program_id) THEN false
    WHEN public.has_permission_for('schools.manage_enrollments', target_program_id) THEN false
    WHEN public.has_permission_for('schools.manage_attendance', target_program_id) THEN false
    WHEN public.has_permission_for('schools.assignable_as_contact', target_program_id) THEN false
    ELSE true
  END;
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
  'Notes and interview outcome written by the program staff member assigned to an application. Does not change application status. Leaders decide status and keep their notes in application_admin_notes.';

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

REVOKE ALL ON FUNCTION public.guard_application_staff_review() FROM PUBLIC, anon, authenticated;

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
        AND ar.program_id = application_staff_reviews.program_id
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
        AND ar.program_id = application_staff_reviews.program_id
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

-- ────────────────────────────────────────────────────────────
-- 5. Assigned-contact reads need a current link, not a stale
--    assigned_staff_id. program_staff, program_leaders (via
--    has_schools_access), or another schools.* grant.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_access_assigned_school_record(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_program_staff(target_program_id)
      OR public.has_schools_access(target_program_id)
      OR public.has_permission_for('schools.view_applications', target_program_id)
      OR public.has_permission_for('schools.approve_applications', target_program_id)
      OR public.has_permission_for('schools.manage_enrollments', target_program_id)
      OR public.has_permission_for('schools.manage_attendance', target_program_id)
      OR public.has_permission_for('schools.assignable_as_contact', target_program_id);
$$;

REVOKE ALL ON FUNCTION public.can_access_assigned_school_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_assigned_school_record(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Assigned staff can read their application_responses" ON public.application_responses;
CREATE POLICY "Assigned staff can read their application_responses"
  ON public.application_responses FOR SELECT
  USING (
    public.application_gate(
      program_id,
      assigned_staff_id = auth.uid()
      AND public.can_access_assigned_school_record(program_id)
    )
  );

DROP POLICY IF EXISTS "Assigned staff can read their enrollments" ON public.enrollments;
CREATE POLICY "Assigned staff can read their enrollments"
  ON public.enrollments FOR SELECT
  USING (
    assigned_staff_id = auth.uid()
    AND public.can_access_assigned_school_record(program_id)
  );

-- ────────────────────────────────────────────────────────────
-- 6. Leader notes move to their own table. Table grants on
--    application_responses are unchanged. The old column stays
--    populated so a server that has not been deployed yet can
--    still write it. This migration only copies. Clearing the
--    column is the follow-up in docs/program-staff.md, run once
--    that new build is the only one live.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_admin_notes (
  application_response_id uuid PRIMARY KEY REFERENCES public.application_responses(id) ON DELETE CASCADE,
  program_id              uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  notes                   text,
  updated_by              uuid REFERENCES public.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_admin_notes_program_idx
  ON public.application_admin_notes (program_id);

COMMENT ON TABLE public.application_admin_notes IS
  'Leader notes for an application. Readable and writable by the same people userCanManageProgram accepts. Not visible to program staff.';

COMMENT ON COLUMN public.application_responses.admin_notes IS
  'Deprecated. Copied into application_admin_notes by migration 304. Still holds the text until the follow-up in docs/program-staff.md, which runs once the new build is the only one live. Do not read or write from the new app. Drop in a later migration.';

-- Idempotent copy. A second run inserts nothing new and does not
-- change a notes row that already exists, including one a leader
-- edited in the new table after the first copy.
INSERT INTO public.application_admin_notes (application_response_id, program_id, notes)
SELECT id, program_id, admin_notes
  FROM public.application_responses
 WHERE admin_notes IS NOT NULL
   AND btrim(admin_notes) <> ''
ON CONFLICT (application_response_id) DO NOTHING;

-- The client's program_id is ignored. The row always belongs to the
-- application's school, so a leader of school A cannot park a note on
-- a school B application by sending program_id = A.
CREATE OR REPLACE FUNCTION public.set_application_admin_note_program()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_program uuid;
BEGIN
  SELECT program_id INTO v_program
    FROM public.application_responses
   WHERE id = NEW.application_response_id;
  IF v_program IS NULL THEN
    RAISE EXCEPTION 'application not found';
  END IF;
  NEW.program_id := v_program;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_application_admin_note_program ON public.application_admin_notes;
CREATE TRIGGER trg_set_application_admin_note_program
  BEFORE INSERT OR UPDATE ON public.application_admin_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_application_admin_note_program();

REVOKE ALL ON FUNCTION public.set_application_admin_note_program() FROM PUBLIC, anon, authenticated;

-- Same people as userCanManageProgram: admins, named leaders,
-- schools.manage, schools.approve_applications, schools.manage_enrollments
-- (global or this program), and the program_leader role.
CREATE OR REPLACE FUNCTION public.can_manage_program_applications(target_program_id uuid)
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
      );
$$;

REVOKE ALL ON FUNCTION public.can_manage_program_applications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_program_applications(uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_sync_admin_notes_from_response ON public.application_responses;
DROP TRIGGER IF EXISTS trg_sync_admin_notes_from_table ON public.application_admin_notes;
DROP FUNCTION IF EXISTS public.sync_admin_notes_from_response();
DROP FUNCTION IF EXISTS public.sync_admin_notes_from_table();

ALTER TABLE public.application_admin_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read application admin notes" ON public.application_admin_notes;
CREATE POLICY "Managers read application admin notes"
  ON public.application_admin_notes FOR SELECT
  USING (
    public.application_gate(
      program_id,
      public.can_manage_program_applications(program_id)
    )
  );

DROP POLICY IF EXISTS "Managers write application admin notes" ON public.application_admin_notes;
CREATE POLICY "Managers write application admin notes"
  ON public.application_admin_notes FOR INSERT
  WITH CHECK (
    public.application_gate(
      program_id,
      public.can_manage_program_applications(program_id)
    )
  );

DROP POLICY IF EXISTS "Managers update application admin notes" ON public.application_admin_notes;
CREATE POLICY "Managers update application admin notes"
  ON public.application_admin_notes FOR UPDATE
  USING (
    public.application_gate(
      program_id,
      public.can_manage_program_applications(program_id)
    )
  )
  WITH CHECK (
    public.application_gate(
      program_id,
      public.can_manage_program_applications(program_id)
    )
  );

-- ────────────────────────────────────────────────────────────
-- 7. Switch and remove. One function, one transaction. A leader
--    may add staff, drop this program's leader row, and drop a
--    program-scoped schools.assignable_as_contact. Any other
--    program-scoped schools.* grant needs is_admin(). Super
--    admins are refused. school_leader is not revoked here:
--    assigned_by cannot tell a system grant from a hand grant.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_program_contact_assignments(
  target_program_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.application_responses
     SET assigned_staff_id = NULL,
         staff_assigned_at = NULL,
         staff_assigned_by = NULL,
         staff_viewed_at = NULL
   WHERE program_id = target_program_id
     AND assigned_staff_id = target_user_id;

  UPDATE public.enrollments
     SET assigned_staff_id = NULL,
         staff_assigned_at = NULL,
         staff_assigned_by = NULL,
         staff_viewed_at = NULL
   WHERE program_id = target_program_id
     AND assigned_staff_id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_person_to_program_staff(
  target_program_id uuid,
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_is_admin boolean;
  extra_grants text;
  removed_leader boolean := false;
  removed_assignable boolean := false;
  n integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  caller_is_admin := public.is_admin();

  IF NOT public.has_schools_access(target_program_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- After authorization, so a stranger gets the same 403 for every target.
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = target_user_id
       AND r.name = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Refusing to switch a super admin' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.string_agg(p.key, ', ' ORDER BY p.key)
    INTO extra_grants
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
   WHERE up.user_id = target_user_id
     AND up.scope_type = 'program'
     AND up.scope_id = target_program_id
     AND p.key LIKE 'schools.%'
     AND p.key <> 'schools.assignable_as_contact';

  IF extra_grants IS NOT NULL AND NOT caller_is_admin THEN
    RAISE EXCEPTION
      'An admin is needed to move this person to staff. They have other school permissions on this program (%).',
      extra_grants
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.program_staff (program_id, user_id, added_by)
  VALUES (target_program_id, target_user_id, caller)
  ON CONFLICT (program_id, user_id) DO NOTHING;

  DELETE FROM public.program_leaders
   WHERE program_id = target_program_id
     AND user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed_leader := n > 0;

  DELETE FROM public.user_permissions up
   USING public.permissions p
   WHERE up.permission_id = p.id
     AND up.user_id = target_user_id
     AND up.scope_type = 'program'
     AND up.scope_id = target_program_id
     AND p.key = 'schools.assignable_as_contact';
  GET DIAGNOSTICS n = ROW_COUNT;
  removed_assignable := n > 0;

  -- Assignments stay. The person is staff now, so they remain the contact.

  RETURN pg_catalog.jsonb_build_object(
    'removed_leader', removed_leader,
    'removed_assignable', removed_assignable
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_program_staff(
  target_program_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_schools_access(target_program_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.program_staff
   WHERE program_id = target_program_id
     AND user_id = target_user_id;

  -- Keep the contact list when they can still be assigned: still a leader,
  -- still hold assignable_as_contact (this program or global), or super admin.
  IF NOT EXISTS (
    SELECT 1 FROM public.program_leaders
     WHERE program_id = target_program_id AND user_id = target_user_id
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
     WHERE up.user_id = target_user_id
       AND p.key = 'schools.assignable_as_contact'
       AND (
         up.scope_type IS NULL
         OR (up.scope_type = 'program' AND up.scope_id = target_program_id)
       )
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = target_user_id
       AND r.name = 'super_admin'
  ) THEN
    PERFORM public.clear_program_contact_assignments(target_program_id, target_user_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_program_contact_assignments(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.switch_person_to_program_staff(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_program_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_person_to_program_staff(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_program_staff(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- Validation (do not call the switch as part of applying this)
-- ------------------------------------------------------------
--   SELECT public.is_program_staff('<program uuid>');
-- Switching one person: docs/program-staff.md
-- ============================================================
