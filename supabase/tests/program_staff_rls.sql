-- Disposable RLS check for migration 304. Not a migration.
-- Builds the tables and helper functions the migration calls, adds the
-- permissive policies staff must not widen, applies 304, then reads and
-- writes as authenticated users.
--
--   dropdb --if-exists program_staff_rls && createdb program_staff_rls
--   psql -v ON_ERROR_STOP=1 -d program_staff_rls -f supabase/tests/program_staff_rls.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('test.admin', true) = 'true';
$$;

CREATE OR REPLACE FUNCTION public.has_role(role_name text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT role_name = coalesce(current_setting('test.role', true), '');
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT position(required_permission in coalesce(current_setting('test.perms', true), '')) > 0;
$$;

CREATE OR REPLACE FUNCTION public.has_permission_for(required_permission text, target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.has_permission(required_permission);
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.programs (id uuid PRIMARY KEY);
CREATE TABLE public.program_leaders (
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid NOT NULL REFERENCES public.users(id)
);

CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_admin()
      OR public.has_permission('schools.manage')
      OR EXISTS (
        SELECT 1 FROM public.program_leaders
        WHERE program_id = target_program_id AND user_id = auth.uid()
      );
$$;

CREATE OR REPLACE FUNCTION public.program_applications_expired(pid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.can_access_expired_applications()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.application_gate(pid uuid, normal_access boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(normal_access, false); $$;

CREATE TABLE public.application_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid REFERENCES public.users(id),
  assigned_staff_id uuid REFERENCES public.users(id),
  staff_assigned_at timestamptz,
  staff_assigned_by uuid,
  staff_viewed_at timestamptz,
  admin_notes text,
  reviewed_by uuid,
  status text NOT NULL DEFAULT 'submitted'
);
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid REFERENCES public.users(id),
  assigned_staff_id uuid REFERENCES public.users(id),
  staff_assigned_at timestamptz,
  staff_assigned_by uuid,
  staff_viewed_at timestamptz
);
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  scope_type text
);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permissions(id),
  scope_type text,
  scope_id uuid
);
CREATE TABLE public.application_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  label text NOT NULL
);
CREATE TABLE public.reference_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  label text NOT NULL
);
CREATE TABLE public.reference_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  label text NOT NULL
);
CREATE TABLE public.program_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  email_type text NOT NULL
);
CREATE TABLE public.program_email_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  email_type text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL
);
CREATE TABLE public.school_fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  tuition_zar numeric NOT NULL
);
CREATE TABLE public.student_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  discount_zar numeric NOT NULL DEFAULT 0,
  tuition_zar numeric NOT NULL
);
CREATE TABLE public.student_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_fee_id uuid NOT NULL REFERENCES public.student_fees(id)
);
CREATE TABLE public.program_charge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  amount numeric NOT NULL
);
CREATE TABLE public.billing_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  tier_prices jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.billing_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id)
);
CREATE TABLE public.fee_charge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.billing_courses(id),
  amount numeric NOT NULL
);
CREATE TABLE public.student_billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  program_id uuid NOT NULL REFERENCES public.programs(id)
);
CREATE TABLE public.student_billing_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.student_billing_plans(id),
  amount numeric NOT NULL
);

ALTER TABLE public.application_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Assigned staff can read their enrollments"
  ON public.enrollments FOR SELECT
  USING (assigned_staff_id = auth.uid());
ALTER TABLE public.application_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_email_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_charge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_charge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_billing_schedule ENABLE ROW LEVEL SECURITY;

-- Deliberately broad, matching the production "any authenticated user can
-- read the price list" policies. Migration 304 must close that for staff
-- without closing it for leaders.
CREATE POLICY open_read_fees ON public.school_fee_structures FOR SELECT USING (true);
CREATE POLICY open_read_payments ON public.student_payments FOR SELECT USING (true);
CREATE POLICY open_read_student_fees ON public.student_fees FOR SELECT USING (true);
CREATE POLICY open_read_charges ON public.program_charge_items FOR SELECT USING (true);
CREATE POLICY open_read_schedules ON public.billing_schedules FOR SELECT USING (true);
CREATE POLICY open_read_course_charges ON public.fee_charge_items FOR SELECT USING (true);
CREATE POLICY open_read_plans ON public.student_billing_plans FOR SELECT USING (true);
CREATE POLICY open_read_plan_rows ON public.student_billing_schedule FOR SELECT USING (true);
CREATE POLICY open_write_questions ON public.application_questions FOR INSERT WITH CHECK (true);
CREATE POLICY open_read_questions ON public.application_questions FOR SELECT USING (true);
CREATE POLICY open_write_emails ON public.program_email_templates FOR INSERT WITH CHECK (true);
CREATE POLICY open_read_emails ON public.program_email_templates FOR SELECT USING (true);
CREATE POLICY leaders_update_responses ON public.application_responses FOR UPDATE
  USING (public.has_schools_access(program_id))
  WITH CHECK (public.has_schools_access(program_id));
CREATE POLICY "Schools managers can read all application responses"
  ON public.application_responses FOR SELECT
  USING (public.has_schools_access(program_id));
CREATE POLICY "Assigned staff can read their application_responses"
  ON public.application_responses FOR SELECT
  USING (assigned_staff_id = auth.uid());

\ir ../migrations/304_program_staff.sql

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Seed. SBI's id is used as program A so the fixture matches the request.
INSERT INTO public.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
INSERT INTO public.programs (id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'),
  ('44444444-4444-4444-4444-444444444444');
INSERT INTO public.program_leaders (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.program_staff (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111'),
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.application_responses (id, program_id, assigned_staff_id, admin_notes) VALUES
  ('55555555-5555-5555-5555-555555555555', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111', 'Leader only'),
  ('66666666-6666-6666-6666-666666666666', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33333333-3333-3333-3333-333333333333', NULL);
INSERT INTO public.enrollments (id, program_id, assigned_staff_id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.school_fee_structures (program_id, tuition_zar) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 12000),
  ('44444444-4444-4444-4444-444444444444', 8000);
INSERT INTO public.student_fees (id, user_id, program_id, discount_zar, tuition_zar) VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 500, 12000),
  ('88888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 250, 12000);
INSERT INTO public.student_payments (student_fee_id) VALUES
  ('77777777-7777-7777-7777-777777777777'),
  ('88888888-8888-8888-8888-888888888888');
INSERT INTO public.program_email_templates (program_id, email_type) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'application_received');
INSERT INTO public.billing_courses (id, program_id) VALUES
  ('99999999-9999-9999-9999-999999999999', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48');
INSERT INTO public.fee_charge_items (course_id, amount) VALUES
  ('99999999-9999-9999-9999-999999999999', 1000);
INSERT INTO public.student_billing_plans (id, user_id, program_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48');
INSERT INTO public.student_billing_schedule (plan_id, amount) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1000);
INSERT INTO public.program_charge_items (program_id, amount) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 1000);
INSERT INTO public.billing_schedules (program_id, tier_prices) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '{"A": 12000}'::jsonb);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- The blanket grant above hands admin_notes back. Take it away again.
REVOKE SELECT (admin_notes), UPDATE (admin_notes), INSERT (admin_notes)
  ON public.application_responses FROM authenticated;

-- Applying the file twice must not fail or duplicate policies.
\ir ../migrations/304_program_staff.sql

-- ── staff only ────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
SELECT set_config('test.admin', '', false);
SELECT set_config('test.role', '', false);
SELECT set_config('test.perms', '', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.application_responses) <> 1 THEN
    RAISE EXCEPTION 'staff should see only the application assigned to them';
  END IF;
  IF (SELECT id FROM public.application_responses) <> '55555555-5555-5555-5555-555555555555' THEN
    RAISE EXCEPTION 'staff saw the wrong application';
  END IF;
  IF (SELECT count(*) FROM public.school_fee_structures WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48') <> 0 THEN
    RAISE EXCEPTION 'staff saw their school fee structure';
  END IF;
  IF (SELECT count(*) FROM public.school_fee_structures WHERE program_id = '44444444-4444-4444-4444-444444444444') <> 1 THEN
    RAISE EXCEPTION 'staff was blocked from a school they do not staff';
  END IF;
  IF (SELECT count(*) FROM public.student_fees) <> 1
     OR (SELECT user_id FROM public.student_fees) <> '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'staff should see only their own student fee row';
  END IF;
  IF (SELECT count(*) FROM public.student_payments) <> 1 THEN
    RAISE EXCEPTION 'staff saw another student payment';
  END IF;
  IF (SELECT count(*) FROM public.program_email_templates) <> 0 THEN
    RAISE EXCEPTION 'staff read program emails';
  END IF;
  IF (SELECT count(*) FROM public.fee_charge_items) <> 0 THEN
    RAISE EXCEPTION 'staff saw course charges';
  END IF;
  IF (SELECT count(*) FROM public.program_charge_items) <> 0
     OR (SELECT count(*) FROM public.billing_schedules) <> 0
     OR (SELECT count(*) FROM public.student_billing_plans) <> 0
     OR (SELECT count(*) FROM public.student_billing_schedule) <> 0 THEN
    RAISE EXCEPTION 'staff saw billing rows';
  END IF;
END $$;

DO $$
BEGIN
  INSERT INTO public.application_questions (program_id, label)
  VALUES ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'Nope');
  RAISE EXCEPTION 'staff inserted an application question';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  INSERT INTO public.program_email_templates (program_id, email_type)
  VALUES ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'hacked');
  RAISE EXCEPTION 'staff inserted an email template';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  UPDATE public.application_responses SET status = 'accepted'
   WHERE id = '55555555-5555-5555-5555-555555555555';
  IF FOUND THEN
    RAISE EXCEPTION 'staff changed an application status';
  END IF;
END $$;

INSERT INTO public.application_staff_reviews
  (application_response_id, program_id, author_id, notes, interview_outcome)
VALUES
  ('55555555-5555-5555-5555-555555555555', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
   '11111111-1111-1111-1111-111111111111', 'Solid interview', 'recommend');

DO $$
BEGIN
  INSERT INTO public.application_staff_reviews
    (application_response_id, program_id, author_id, notes, interview_outcome)
  VALUES
    ('66666666-6666-6666-6666-666666666666', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
     '11111111-1111-1111-1111-111111111111', 'Not mine', 'decline');
  RAISE EXCEPTION 'staff reviewed an application that is not assigned to them';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%assigned program staff%' THEN
    RAISE;
  END IF;
END $$;

-- ── leader who is also listed as staff keeps full access ──
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.application_responses) <> 2 THEN
    RAISE EXCEPTION 'leader lost sight of applications';
  END IF;
  IF (SELECT count(*) FROM public.school_fee_structures WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48') <> 1 THEN
    RAISE EXCEPTION 'leader who is also staff lost the fee structure';
  END IF;
  IF (SELECT count(*) FROM public.student_fees) <> 2 THEN
    RAISE EXCEPTION 'leader lost student fees';
  END IF;
  IF (SELECT count(*) FROM public.program_email_templates) <> 1 THEN
    RAISE EXCEPTION 'leader lost email templates';
  END IF;
  IF (SELECT count(*) FROM public.application_staff_reviews) <> 1 THEN
    RAISE EXCEPTION 'leader cannot read the staff review';
  END IF;
END $$;

INSERT INTO public.application_questions (program_id, label)
VALUES ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'From a leader');

UPDATE public.application_responses SET status = 'interview_scheduled'
 WHERE id = '66666666-6666-6666-6666-666666666666';

-- ── existing schools.* grant keeps finance visibility ──
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
SELECT set_config('test.perms', 'schools.assignable_as_contact', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.school_fee_structures WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48') <> 1 THEN
    RAISE EXCEPTION 'a staff member who still holds schools.* lost fee visibility';
  END IF;
END $$;

-- Staff cannot read the notes column or the notes table. A leader can
-- read and write the notes table, and that write lands on the column.
DO $$
BEGIN
  PERFORM admin_notes FROM public.application_responses;
  RAISE EXCEPTION 'staff selected admin_notes';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.application_admin_notes) <> 0 THEN
    RAISE EXCEPTION 'staff read leader notes';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

DO $$
BEGIN
  IF (SELECT notes FROM public.application_admin_notes
       WHERE application_response_id = '55555555-5555-5555-5555-555555555555')
     IS DISTINCT FROM 'Leader only' THEN
    RAISE EXCEPTION 'leader could not read admin notes';
  END IF;
END $$;

UPDATE public.application_admin_notes
   SET notes = 'Updated by leader'
 WHERE application_response_id = '55555555-5555-5555-5555-555555555555';

RESET ROLE;

DO $$
BEGIN
  IF (SELECT admin_notes FROM public.application_responses
       WHERE id = '55555555-5555-5555-5555-555555555555')
     IS DISTINCT FROM 'Updated by leader' THEN
    RAISE EXCEPTION 'leader note did not sync back to the column';
  END IF;
END $$;

-- Removing the staff row drops access even if assigned_staff_id remains.
RESET ROLE;
DELETE FROM public.program_staff
 WHERE user_id = '11111111-1111-1111-1111-111111111111';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
SELECT set_config('test.perms', '', false);
SELECT set_config('test.admin', '', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.application_responses) <> 0 THEN
    RAISE EXCEPTION 'removed staff still read an application';
  END IF;
  IF (SELECT count(*) FROM public.enrollments) <> 0 THEN
    RAISE EXCEPTION 'removed staff still read an enrollment';
  END IF;
END $$;

RESET ROLE;

-- Switch: a leader cannot strip other schools.* grants. An admin can
-- switch without deleting those grants. A failure mid-function rolls back.
INSERT INTO public.roles (id, name) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'super_admin');
INSERT INTO public.permissions (id, key) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'schools.assignable_as_contact'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'schools.manage');
INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'program', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'),
  ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'program', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48');
INSERT INTO public.program_leaders (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33333333-3333-3333-3333-333333333333');
UPDATE public.application_responses
   SET assigned_staff_id = '33333333-3333-3333-3333-333333333333'
 WHERE id = '66666666-6666-6666-6666-666666666666';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);

DO $$
BEGIN
  PERFORM public.switch_person_to_program_staff(
    '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
    '33333333-3333-3333-3333-333333333333'
  );
  RAISE EXCEPTION 'leader switched someone who holds schools.manage';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'An admin is needed%' THEN
    RAISE;
  END IF;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.program_staff
       WHERE user_id = '33333333-3333-3333-3333-333333333333') <> 0 THEN
    RAISE EXCEPTION 'refused switch still inserted program_staff';
  END IF;
  IF (SELECT count(*) FROM public.program_leaders
       WHERE user_id = '33333333-3333-3333-3333-333333333333') <> 1 THEN
    RAISE EXCEPTION 'refused switch dropped the leader row';
  END IF;
END $$;

-- Admin proceeds, and leaves schools.manage in place.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT set_config('test.admin', 'true', false);

SELECT public.switch_person_to_program_staff(
  '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
  '33333333-3333-3333-3333-333333333333'
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.program_staff
       WHERE user_id = '33333333-3333-3333-3333-333333333333') <> 1 THEN
    RAISE EXCEPTION 'admin switch did not add staff';
  END IF;
  IF (SELECT count(*) FROM public.program_leaders
       WHERE user_id = '33333333-3333-3333-3333-333333333333') <> 0 THEN
    RAISE EXCEPTION 'admin switch left the leader row';
  END IF;
  IF (SELECT count(*) FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = '33333333-3333-3333-3333-333333333333'
         AND p.key = 'schools.assignable_as_contact') <> 0 THEN
    RAISE EXCEPTION 'assignable contact grant was not removed';
  END IF;
  IF (SELECT count(*) FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = '33333333-3333-3333-3333-333333333333'
         AND p.key = 'schools.manage') <> 1 THEN
    RAISE EXCEPTION 'admin switch stripped schools.manage';
  END IF;
  IF (SELECT assigned_staff_id FROM public.application_responses
       WHERE id = '66666666-6666-6666-6666-666666666666') IS NOT NULL THEN
    RAISE EXCEPTION 'switch left the contact assignment';
  END IF;
END $$;

-- Partial failure rolls the whole switch back.
INSERT INTO public.program_leaders (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111');
UPDATE public.application_responses
   SET assigned_staff_id = '11111111-1111-1111-1111-111111111111'
 WHERE id = '55555555-5555-5555-5555-555555555555';
DELETE FROM public.program_staff
 WHERE user_id = '11111111-1111-1111-1111-111111111111';

CREATE OR REPLACE FUNCTION public.fail_contact_clear()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced failure';
END;
$$;

CREATE TRIGGER fail_contact_clear
  BEFORE UPDATE ON public.application_responses
  FOR EACH ROW
  WHEN (OLD.assigned_staff_id IS NOT NULL AND NEW.assigned_staff_id IS NULL)
  EXECUTE FUNCTION public.fail_contact_clear();

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT set_config('test.admin', 'true', false);

DO $$
BEGIN
  PERFORM public.switch_person_to_program_staff(
    '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
    '11111111-1111-1111-1111-111111111111'
  );
  RAISE EXCEPTION 'switch succeeded despite a forced failure';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%forced failure%' THEN
    RAISE;
  END IF;
END $$;

RESET ROLE;
DROP TRIGGER fail_contact_clear ON public.application_responses;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.program_staff
       WHERE user_id = '11111111-1111-1111-1111-111111111111') <> 0 THEN
    RAISE EXCEPTION 'rolled-back switch left a staff row';
  END IF;
  IF (SELECT count(*) FROM public.program_leaders
       WHERE user_id = '11111111-1111-1111-1111-111111111111') <> 1 THEN
    RAISE EXCEPTION 'rolled-back switch dropped the leader row';
  END IF;
  IF (SELECT assigned_staff_id FROM public.application_responses
       WHERE id = '55555555-5555-5555-5555-555555555555')
     IS DISTINCT FROM '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'rolled-back switch cleared the assignment';
  END IF;
END $$;

RESET ROLE;
\echo 'program staff RLS checks passed'
