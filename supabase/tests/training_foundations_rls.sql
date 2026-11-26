-- Disposable RLS check for migrations 334 and 336. Not a migration.
-- Stubs the tables and helpers 334 calls, applies 334 twice, then
-- reads and writes as: a student, another student, the staff member
-- walking with her (from the old assigned_staff_id), a second walker,
-- the school leader, program staff who is not walking with her, an
-- outreach leader with no school access, staff of another school, and anon.
--
--   dropdb --if-exists training_foundations && createdb training_foundations
--   psql -v ON_ERROR_STOP=1 -d training_foundations -f supabase/tests/training_foundations_rls.sql
--
-- Never point this at a shared or hosted database.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('test.admin', true) = 'true';
$$;
CREATE OR REPLACE FUNCTION public.has_permission_for(required_permission text, target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT required_permission = ANY (
    string_to_array(coalesce(current_setting('test.perms', true), ''), ',')
  );
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY, display_name text);
CREATE TABLE public.programs (id uuid PRIMARY KEY);
CREATE TABLE public.program_leaders (
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid NOT NULL REFERENCES public.users(id)
);
CREATE TABLE public.program_staff (
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid NOT NULL REFERENCES public.users(id)
);
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid REFERENCES public.users(id),
  assigned_staff_id uuid REFERENCES public.users(id),
  staff_assigned_at timestamptz,
  staff_assigned_by uuid
);

-- Same shape as migrations 145 and 304.
CREATE OR REPLACE FUNCTION public.is_program_leader(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.program_leaders
                 WHERE program_id = target_program_id AND user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.has_permission_for('schools.manage', target_program_id)
      OR public.is_program_leader(target_program_id);
$$;
CREATE OR REPLACE FUNCTION public.is_program_staff(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.program_staff
                 WHERE program_id = target_program_id AND user_id = auth.uid());
$$;

-- The enrolment policies that exist before 334 (own, 052 assigned, managers).
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own" ON public.enrollments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "assigned" ON public.enrollments FOR SELECT USING (assigned_staff_id = auth.uid());
CREATE POLICY "managers" ON public.enrollments FOR ALL
  USING (public.has_schools_access(program_id)) WITH CHECK (public.has_schools_access(program_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrollments TO authenticated;
GRANT SELECT ON public.users, public.programs TO authenticated;

INSERT INTO public.programs VALUES
  ('a1000000-0000-0000-0000-000000000001'), ('a1000000-0000-0000-0000-000000000002');
INSERT INTO public.users VALUES
  ('10000000-0000-0000-0000-000000000001', 'Grace'),
  ('10000000-0000-0000-0000-000000000002', 'Sipho'),
  ('20000000-0000-0000-0000-000000000001', 'Daniel'),
  ('20000000-0000-0000-0000-000000000002', 'Ruth'),
  ('20000000-0000-0000-0000-000000000003', 'Kim'),
  ('20000000-0000-0000-0000-000000000004', 'Paul'),
  ('20000000-0000-0000-0000-000000000005', 'Olive'),
  ('20000000-0000-0000-0000-000000000006', 'Xavier');
INSERT INTO public.program_leaders VALUES
  ('a1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000006');
INSERT INTO public.program_staff VALUES
  ('a1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004');
-- Grace: Daniel is in the old single column. Sipho: nobody.
INSERT INTO public.enrollments (id, program_id, user_id, assigned_staff_id, staff_assigned_at) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-09-07'),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000002', NULL, NULL);

\ir ../migrations/334_training_foundations.sql
\ir ../migrations/334_training_foundations.sql
\ir ../migrations/336_save_student_checkin.sql
\ir ../migrations/336_save_student_checkin.sql

-- Backfill ran once, even though 334 ran twice.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.enrollment_staff) <> 1
     OR (SELECT source FROM public.enrollment_staff) <> 'assigned_staff'
     OR (SELECT starts_on FROM public.enrollment_staff) <> '2026-09-07' THEN
    RAISE EXCEPTION 'backfill from assigned_staff_id is wrong';
  END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);

-- ── Kim (school leader) adds Ruth as a second walker ─────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', false);
INSERT INTO public.enrollment_staff (enrollment_id, user_id, added_by)
VALUES ('e1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000003');

-- ── Daniel (walker, not a manager) ───────────────────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    INSERT INTO public.enrollment_staff (enrollment_id, user_id)
    VALUES ('e1000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'a walker added themselves to another student'; END IF;
END $$;

-- 2026-11-23 is a Monday. program_id is a lie on purpose: the guard fixes it.
INSERT INTO public.student_checkins
  (id, enrollment_id, program_id, week_of, contact, mood, note_for_student, needs_care)
VALUES ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000002', '2026-11-23', 'met', 'okay',
        'Proud of how you led worship on Thursday.', true);
INSERT INTO public.student_checkin_private (checkin_id, note_staff_only)
VALUES ('c1000000-0000-0000-0000-000000000001', 'Still homesick, mum unwell.');

DO $$ BEGIN
  IF (SELECT program_id FROM public.student_checkins
      WHERE id = 'c1000000-0000-0000-0000-000000000001') <> 'a1000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'program_id was not taken from the enrolment';
  END IF;
END $$;

DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
    VALUES ('e1000000-0000-0000-0000-000000000001', '2026-11-24', 'met', 'good');
  EXCEPTION WHEN check_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'a check-in was saved against a Tuesday'; END IF;
END $$;

DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
    VALUES ('e1000000-0000-0000-0000-000000000001', '2026-11-16', 'no_reach', 'good');
  EXCEPTION WHEN check_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'couldn''t reach was saved with a mood'; END IF;
END $$;

INSERT INTO public.today_dismissals (item_key, iso_week) VALUES ('grade:int202', '2026-W48');

-- ── Ruth (second walker) ─────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.enrollments) <> 1 THEN
    RAISE EXCEPTION 'second walker should read exactly her student''s enrolment';
  END IF;
  IF (SELECT count(*) FROM public.student_checkins) <> 1 THEN
    RAISE EXCEPTION 'second walker cannot see the co-walker''s check-in';
  END IF;
  IF (SELECT count(*) FROM public.student_checkin_private) <> 1 THEN
    RAISE EXCEPTION 'second walker cannot see the staff-only note';
  END IF;
  IF (SELECT count(*) FROM public.enrollment_staff) <> 2 THEN
    RAISE EXCEPTION 'second walker should see both walkers';
  END IF;
  IF (SELECT count(*) FROM public.today_dismissals) <> 0 THEN
    RAISE EXCEPTION 'someone else''s Today dismissals are visible';
  END IF;
END $$;

-- Her own check-in in the same week is allowed (one per author).
INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
VALUES ('e1000000-0000-0000-0000-000000000001', '2026-11-23', 'called', 'good');

-- She may take the care flag but not rewrite Daniel's check-in.
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    UPDATE public.student_checkins SET mood = 'great'
    WHERE id = 'c1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN raise_exception THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'a co-walker changed someone else''s check-in'; END IF;
END $$;
UPDATE public.student_checkins
   SET care_taken_by = '20000000-0000-0000-0000-000000000002', care_taken_at = now()
 WHERE id = 'c1000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT care_taken_by FROM public.student_checkins
      WHERE id = 'c1000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'co-walker could not take the care flag';
  END IF;
END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE public.student_checkin_private SET note_staff_only = 'edited'
  WHERE checkin_id = 'c1000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'a co-walker edited someone else''s staff-only note'; END IF;
END $$;

-- ── Paul (program staff, not walking with Grace) ─────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.student_checkins) <> 2 THEN
    RAISE EXCEPTION 'program staff should see dates and moods for their school';
  END IF;
  IF (SELECT count(*) FROM public.student_checkin_private) <> 0 THEN
    RAISE EXCEPTION 'program staff read a staff-only note they did not write';
  END IF;
END $$;
INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
VALUES ('e1000000-0000-0000-0000-000000000002', '2026-11-23', 'met', 'great');

-- ── Kim (school leader) ──────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.student_checkin_private) <> 1 THEN
    RAISE EXCEPTION 'school leader cannot read staff-only notes';
  END IF;
  IF (SELECT count(*) FROM public.student_checkins) <> 3 THEN
    RAISE EXCEPTION 'school leader should see every check-in in the school';
  END IF;
END $$;

-- ── Olive (outreach leader, no school access) ────────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.student_checkins) <> 0
     OR (SELECT count(*) FROM public.student_checkin_private) <> 0
     OR (SELECT count(*) FROM public.enrollment_staff) <> 0 THEN
    RAISE EXCEPTION 'outreach leader saw Training data';
  END IF;
END $$;

-- ── Xavier (leader of a different school) ────────────────────
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000006', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  IF (SELECT count(*) FROM public.student_checkins) <> 0
     OR (SELECT count(*) FROM public.student_checkin_private) <> 0 THEN
    RAISE EXCEPTION 'another school''s leader saw these check-ins';
  END IF;
  BEGIN
    INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
    VALUES ('e1000000-0000-0000-0000-000000000001', '2026-11-23', 'met', 'good');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'another school''s leader wrote a check-in'; END IF;
END $$;

-- ── Grace (the student) ──────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  IF (SELECT count(*) FROM public.student_checkins) <> 0 THEN
    RAISE EXCEPTION 'student read check-in rows (mood, care flag)';
  END IF;
  IF (SELECT count(*) FROM public.student_checkin_private) <> 0 THEN
    RAISE EXCEPTION 'student read a staff-only note';
  END IF;
  IF (SELECT count(*) FROM public.my_checkin_notes()) <> 1
     OR (SELECT note_for_student FROM public.my_checkin_notes()) <> 'Proud of how you led worship on Thursday.'
     OR (SELECT author_name FROM public.my_checkin_notes()) <> 'Daniel' THEN
    RAISE EXCEPTION 'student did not get exactly the note written for her';
  END IF;
  IF (SELECT count(*) FROM public.enrollment_staff) <> 2 THEN
    RAISE EXCEPTION 'student should see both people walking with her';
  END IF;
  BEGIN
    INSERT INTO public.student_checkins (enrollment_id, week_of, contact, mood)
    VALUES ('e1000000-0000-0000-0000-000000000001', '2026-11-23', 'met', 'great');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'student wrote a check-in about herself'; END IF;
END $$;

-- ── Sipho (another student) ──────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.my_checkin_notes()) <> 0 THEN
    RAISE EXCEPTION 'a student saw notes written for someone else';
  END IF;
  IF (SELECT count(*) FROM public.enrollment_staff) <> 0 THEN
    RAISE EXCEPTION 'a student saw who walks with other students';
  END IF;
END $$;

-- ── anon ─────────────────────────────────────────────────────
RESET ROLE;
SET ROLE anon;
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    PERFORM 1 FROM public.student_checkins;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'anon can query check-ins'; END IF;
END $$;

-- ── The website changes the old single column ────────────────
RESET ROLE;
UPDATE public.enrollments
   SET assigned_staff_id = '20000000-0000-0000-0000-000000000003'
 WHERE id = 'e1000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT ends_on FROM public.enrollment_staff
      WHERE user_id = '20000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'replacing assigned_staff_id did not end the old mirrored walker';
  END IF;
  IF (SELECT ends_on FROM public.enrollment_staff
      WHERE user_id = '20000000-0000-0000-0000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'a walker added through Training was ended by the website';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.enrollment_staff
                 WHERE user_id = '20000000-0000-0000-0000-000000000003'
                   AND source = 'assigned_staff' AND ends_on IS NULL) THEN
    RAISE EXCEPTION 'the new assigned_staff_id was not mirrored';
  END IF;
END $$;

-- Daniel's mirrored row ended today, so he is no longer walking with her,
-- but he can still read the note he wrote himself.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  IF public.is_walking_with('e1000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ended walker still counts as walking with her';
  END IF;
  IF (SELECT count(*) FROM public.student_checkin_private) <> 1 THEN
    RAISE EXCEPTION 'author lost his own staff-only note';
  END IF;
END $$;


-- ── 336: save_student_checkin ────────────────────────────────
-- Paul (program staff) checks in with Sipho through the function: one
-- row plus its private note; saving again the same week updates it; an
-- empty staff note removes the private row; care is "new" only once.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', false);
DO $$ DECLARE r record; n int; BEGIN
  SELECT * INTO r FROM public.save_student_checkin(
    'e1000000-0000-0000-0000-000000000002', '2026-11-30', 'met', 'good',
    '  Good to see you  ', 'Quiet this week', true);
  IF NOT r.newly_needs_care THEN RAISE EXCEPTION '336: first flag should be new'; END IF;
  SELECT count(*) INTO n FROM public.student_checkin_private WHERE checkin_id = r.checkin_id;
  IF n <> 1 THEN RAISE EXCEPTION '336: private note not saved'; END IF;
  IF (SELECT note_for_student FROM public.student_checkins WHERE id = r.checkin_id) <> 'Good to see you' THEN
    RAISE EXCEPTION '336: note for student not trimmed';
  END IF;

  SELECT * INTO r FROM public.save_student_checkin(
    'e1000000-0000-0000-0000-000000000002', '2026-11-30', 'no_reach', 'great', '', '   ', true);
  IF r.newly_needs_care THEN RAISE EXCEPTION '336: a flag already raised was reported as new'; END IF;
  SELECT count(*) INTO n FROM public.student_checkins
   WHERE enrollment_id = 'e1000000-0000-0000-0000-000000000002' AND week_of = '2026-11-30';
  IF n <> 1 THEN RAISE EXCEPTION '336: second save made a second row'; END IF;
  IF (SELECT mood FROM public.student_checkins WHERE id = r.checkin_id) IS NOT NULL THEN
    RAISE EXCEPTION '336: couldn''t reach kept a mood';
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_checkin_private WHERE checkin_id = r.checkin_id) THEN
    RAISE EXCEPTION '336: empty staff note did not remove the private row';
  END IF;
END $$;

-- Xavier (another school) cannot save through the function either.
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000006', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    PERFORM * FROM public.save_student_checkin(
      'e1000000-0000-0000-0000-000000000002', '2026-11-30', 'met', 'good', null, 'x', false);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION '336: another school''s leader saved a check-in'; END IF;
END $$;

-- Grace (the student) cannot check in on herself through it.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    PERFORM * FROM public.save_student_checkin(
      'e1000000-0000-0000-0000-000000000001', '2026-11-30', 'met', 'great', null, null, false);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION '336: student saved a check-in on herself'; END IF;
END $$;

RESET ROLE;
\echo 'training_foundations_rls: all checks passed'
