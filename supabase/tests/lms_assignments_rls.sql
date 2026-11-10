-- Disposable RLS check for migration 310 (schools LMS assignments). Not a migration.
-- Stubs what 305 / 310 call (auth.uid, permission helpers, is_program_staff,
-- handle_updated_at, storage.buckets / storage.objects), applies 305 and
-- then 310 twice, then reads and writes as each kind of user. Never point
-- this at a shared or remote database.
--
--   dropdb --if-exists lms_assignments_rls && createdb lms_assignments_rls
--   psql -v ON_ERROR_STOP=1 -d lms_assignments_rls -f supabase/tests/lms_assignments_rls.sql
--
-- People (program A = 5ca7…, program B = 4444…):
--   1111 leader of A        2222 staff of A
--   3333 student S1 in A    3334 student S2 in A (made staff of A at the end)
--   7777 leader of B        8888 staff of B
--   3335 student S3 in B
--   9999 holds the program_leader ROLE scoped to B only (no program_leaders
--        row anywhere). Live can_manage_program_applications lets that role
--        through for every program; 310's lms_can_edit must not (F1).
--   anon
--
-- Every role gets a PASS case and a deliberate FAIL case. A FAIL case that
-- does not fail raises, so ON_ERROR_STOP aborts the run.

\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Supabase storage, reduced to what the policies touch.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.has_permission_for(required_permission text, target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  first_name text,
  last_name text,
  preferred_name text
);
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
  status text NOT NULL DEFAULT 'arrived',
  removed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.program_leaders
        WHERE program_id = target_program_id AND user_id = auth.uid()
      );
$$;
CREATE TABLE public.roles (id uuid PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES public.users(id),
  role_id uuid NOT NULL REFERENCES public.roles(id),
  scope_type text,
  scope_id uuid
);
-- The live shape (migration 304), including its UNSCOPED program_leader
-- branch, so the test reproduces the production helper chain.
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
CREATE OR REPLACE FUNCTION public.is_program_staff(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.program_staff
    WHERE program_id = target_program_id AND user_id = auth.uid()
  );
$$;

\ir ../migrations/305_schools_lms_content.sql
\ir ../migrations/310_schools_lms_assignments.sql
-- Re-running must not fail or duplicate anything.
\ir ../migrations/310_schools_lms_assignments.sql

-- Helper: run a statement and require it to fail with one SQLSTATE.
CREATE OR REPLACE FUNCTION public.expect_error(stmt text, want_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
  END;
  IF got IS NULL THEN
    RAISE EXCEPTION 'FAIL (no error): %', label;
  END IF;
  IF want_state IS NOT NULL AND got <> want_state THEN
    RAISE EXCEPTION 'FAIL (% instead of %): %', got, want_state, label;
  END IF;
END;
$$;
-- Helper: run a statement and require it to touch 0 rows.
CREATE OR REPLACE FUNCTION public.expect_rows(stmt text, want bigint, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> want THEN
    RAISE EXCEPTION 'FAIL (% rows, wanted %): %', n, want, label;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.expect_count(q text, want bigint, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || q || ') x' INTO n;
  IF n <> want THEN
    RAISE EXCEPTION 'FAIL (count %, wanted %): %', n, want, label;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expect_error(text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.expect_rows(text, bigint, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.expect_count(text, bigint, text) TO authenticated, anon;

-- ── Seed (as the owner, so RLS does not apply) ────────────
INSERT INTO public.users (id, first_name, last_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Lea', 'Leader'),
  ('22222222-2222-2222-2222-222222222222', 'Sam', 'Staff'),
  ('33333333-3333-3333-3333-333333333333', 'Stu', 'One'),
  ('33343334-3334-3334-3334-333433343334', 'Stu', 'Two'),
  ('77777777-7777-7777-7777-777777777777', 'Bea', 'LeaderB'),
  ('88888888-8888-8888-8888-888888888888', 'Bob', 'StaffB'),
  ('33353335-3335-3335-3335-333533353335', 'Stu', 'Three'),
  ('99999999-9999-9999-9999-999999999999', 'Rae', 'RoleB');
INSERT INTO public.roles (id, name) VALUES ('70000000-0000-0000-0000-000000000001', 'program_leader');
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id) VALUES
  ('99999999-9999-9999-9999-999999999999', '70000000-0000-0000-0000-000000000001', 'program', '44444444-0000-0000-0000-444444444444');
INSERT INTO public.programs (id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'),
  ('44444444-0000-0000-0000-444444444444');
INSERT INTO public.program_leaders (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111'),
  ('44444444-0000-0000-0000-444444444444', '77777777-7777-7777-7777-777777777777');
INSERT INTO public.program_staff (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '22222222-2222-2222-2222-222222222222'),
  ('44444444-0000-0000-0000-444444444444', '88888888-8888-8888-8888-888888888888');
INSERT INTO public.enrollments (id, program_id, user_id) VALUES
  ('e5000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33333333-3333-3333-3333-333333333333'),
  ('e5000000-0000-0000-0000-000000000002', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33343334-3334-3334-3334-333433343334'),
  ('e5000000-0000-0000-0000-000000000003', '44444444-0000-0000-0000-444444444444', '33353335-3335-3335-3335-333533353335');

INSERT INTO public.lms_courses (id, program_id, title, published) VALUES
  ('c1000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'C1', true),
  ('cb000000-0000-0000-0000-00000000000b', '44444444-0000-0000-0000-444444444444', 'CB', true);
INSERT INTO public.lms_modules (id, course_id, title, published) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'M1', true),
  ('ab000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-00000000000b', 'MB', true);
INSERT INTO public.lms_lessons (id, module_id, title, content_type, body, published) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'L1', 'rich_text', 'x', true),
  ('eb000000-0000-0000-0000-00000000000b', 'ab000000-0000-0000-0000-00000000000b', 'LB', 'rich_text', 'x', true);

-- AS1 published, due tomorrow, late OK       (the main flow)
-- AS2 published, due yesterday, late OFF     (late rejected)
-- AS3 draft                                   (hidden from students)
-- AS4 published, due yesterday, late OK      (late accepted, is_late)
-- ASB program B, published
INSERT INTO public.lms_assignments (id, course_id, lesson_id, title, due_at, allow_late, submission_types, max_points, published) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'AS1', now() + interval '1 day', true,  ARRAY['text','link','file'], 10, true),
  ('a5000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', NULL, 'AS2', now() - interval '1 day', false, ARRAY['text'], 10, true),
  ('a5000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', NULL, 'AS3', NULL, true, ARRAY['text'], 10, false),
  ('a5000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', NULL, 'AS4', now() - interval '1 day', true, ARRAY['text'], 10, true),
  ('a5000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-00000000000b', NULL, 'ASB', NULL, true, ARRAY['text'], 5, true);

-- ── Schema checks (as owner) ──────────────────────────────
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, title, max_points) VALUES ('c1000000-0000-0000-0000-000000000001', 'zero', 0)$q$, '23514', 'max_points 0 accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, title, max_points, submission_types) VALUES ('c1000000-0000-0000-0000-000000000001', 'bad', 5, ARRAY['video'])$q$, '23514', 'unknown submission type accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, title, max_points, submission_types) VALUES ('c1000000-0000-0000-0000-000000000001', 'none', 5, ARRAY[]::text[])$q$, '23514', 'empty submission_types accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, lesson_id, title, max_points) VALUES ('c1000000-0000-0000-0000-000000000001', 'eb000000-0000-0000-0000-00000000000b', 'x', 5)$q$, '23514', 'lesson from another course accepted');
SELECT public.expect_error($q$UPDATE public.lms_assignments SET course_id = 'cb000000-0000-0000-0000-00000000000b' WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, '23514', 'assignment moved course');
-- Enrolment of program A against program B's assignment.
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status, body_text) VALUES ('a5000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'x')$q$, '23514', 'cross-school submission accepted');

-- authenticated cannot TRUNCATE; anon has no table grants at all.
SET ROLE authenticated;
SELECT public.expect_error('TRUNCATE public.lms_grades', '42501', 'authenticated truncated lms_grades');
SELECT public.expect_error('TRUNCATE public.lms_submissions', '42501', 'authenticated truncated lms_submissions');
RESET ROLE;

-- ── anon ──────────────────────────────────────────────────
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.expect_error('SELECT 1 FROM public.lms_assignments', '42501', 'anon read lms_assignments');
SELECT public.expect_error('SELECT 1 FROM public.lms_submissions', '42501', 'anon read lms_submissions');
SELECT public.expect_error('SELECT 1 FROM public.lms_submission_files', '42501', 'anon read lms_submission_files');
SELECT public.expect_error('SELECT 1 FROM public.lms_grades', '42501', 'anon read lms_grades');
SELECT public.expect_error('SELECT 1 FROM public.lms_current_submissions', '42501', 'anon read lms_current_submissions');
SELECT public.expect_error($q$SELECT public.lms_grading_roster('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48')$q$, '42501', 'anon ran lms_grading_roster');
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id) VALUES ('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001')$q$, '42501', 'anon inserted a submission');
RESET ROLE;

-- ── S1: draft → files → submit on AS1 ─────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

-- PASS: sees published assignments of A only (AS1, AS2, AS4).
SELECT public.expect_count('SELECT 1 FROM public.lms_assignments', 3, 'S1 should see 3 published A assignments');
-- FAIL: the draft assignment and program B are hidden.
SELECT public.expect_count($q$SELECT 1 FROM public.lms_assignments WHERE title IN ('AS3', 'ASB')$q$, 0, 'S1 saw a draft or other-school assignment');

-- PASS: draft insert; attempt_no / is_late / submitted_at are server-set.
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, attempt_no, body_text, is_late, submitted_at)
VALUES ('5b000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 99, 'My answer', true, NULL);
DO $$
BEGIN
  IF (SELECT attempt_no FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: attempt_no was not server-assigned';
  END IF;
  IF (SELECT is_late FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: a draft was marked late';
  END IF;
END $$;
-- FAIL: a second open draft.
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id) VALUES ('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001')$q$, '23505', 'second draft accepted');
-- FAIL: draft on the unpublished assignment; attempt on S2's enrolment.
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id) VALUES ('a5000000-0000-0000-0000-000000000003', 'e5000000-0000-0000-0000-000000000001')$q$, '42501', 'S1 submitted to an unpublished assignment');
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id) VALUES ('a5000000-0000-0000-0000-000000000004', 'e5000000-0000-0000-0000-000000000002')$q$, '42501', 'S1 inserted on S2''s enrolment');
-- FAIL: javascript: link.
SELECT public.expect_error($q$UPDATE public.lms_submissions SET link_url = 'javascript:alert(1)' WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, '23514', 'javascript: link accepted');
-- PASS: edit own draft.
SELECT public.expect_rows($q$UPDATE public.lms_submissions SET link_url = 'https://example.org/work' WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, 1, 'S1 could not edit own draft');

-- PASS: file on own draft at a uid-free path, and the storage object.
INSERT INTO public.lms_submission_files (id, submission_id, storage_path, file_name, mime, size_bytes) VALUES
  ('f1000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001',
   '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000001.pdf',
   'essay.pdf', 'application/pdf', 1000);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('lms-submissions', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000001.pdf');
-- FAIL: storage object with no file row (e.g. a uid path).
SELECT public.expect_error($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lms-submissions', '33333333-3333-3333-3333-333333333333/x.pdf')$q$, '42501', 'S1 uploaded to an unregistered path');
-- FAIL: path that names a user, bad mime, 21 MB file.
SELECT public.expect_error($q$INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES ('5b000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333/a.pdf', 'a.pdf', 'application/pdf', 10)$q$, '23514', 'path with uid accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES ('5b000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000009.exe', 'a.exe', 'application/x-msdownload', 10)$q$, '23514', 'exe mime accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES ('5b000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000008.pdf', 'big.pdf', 'application/pdf', 22020096)$q$, '23514', '21 MB file accepted');
-- FAIL: 11th file.
DO $$
BEGIN
  FOR i IN 2..10 LOOP
    INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes)
    VALUES ('5b000000-0000-0000-0000-000000000001',
      '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-0000000001' || lpad(i::text, 2, '0') || '.txt',
      'n' || i || '.txt', 'text/plain', 10);
  END LOOP;
END $$;
SELECT public.expect_error($q$INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES ('5b000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000111.txt', 'n11.txt', 'text/plain', 10)$q$, '23514', '11th file accepted');
-- PASS: remove a file from own draft.
SELECT public.expect_rows($q$DELETE FROM public.lms_submission_files WHERE file_name = 'n10.txt'$q$, 1, 'S1 could not remove a draft file');

-- PASS: submit the draft.
SELECT public.expect_rows($q$UPDATE public.lms_submissions SET status = 'submitted' WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, 1, 'S1 could not submit');
DO $$
BEGIN
  IF (SELECT submitted_at FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'FAIL: submitted_at not set';
  END IF;
END $$;
-- FAIL: UPDATE / DELETE of a submitted attempt, and its files.
SELECT public.expect_rows($q$UPDATE public.lms_submissions SET body_text = 'changed' WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, 0, 'S1 updated a submitted attempt');
SELECT public.expect_rows($q$DELETE FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, 0, 'S1 deleted a submitted attempt');
SELECT public.expect_rows($q$DELETE FROM public.lms_submission_files WHERE submission_id = '5b000000-0000-0000-0000-000000000001'$q$, 0, 'S1 deleted files of a submitted attempt');
SELECT public.expect_error($q$INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES ('5b000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-000000000001/0f0f0f0f-0000-4000-8000-000000000222.txt', 'late.txt', 'text/plain', 10)$q$, NULL, 'S1 added a file to a submitted attempt (trigger 23514 fires before RLS)');
SELECT public.expect_rows($q$DELETE FROM storage.objects WHERE bucket_id = 'lms-submissions'$q$, 0, 'S1 deleted a submitted attempt''s object');

-- Late rule. PASS: AS4 (late OK) accepted and marked late.
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, status, body_text)
VALUES ('5b000000-0000-0000-0000-000000000004', 'a5000000-0000-0000-0000-000000000004', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'late but ok');
DO $$
BEGIN
  IF NOT (SELECT is_late FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'FAIL: late attempt not marked is_late';
  END IF;
END $$;
-- FAIL: AS2 (late OFF) — direct submit, and draft-then-submit.
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status, body_text) VALUES ('a5000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'too late')$q$, '23514', 'late insert accepted with allow_late=false');
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, body_text)
VALUES ('5b000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001', 'draft');
SELECT public.expect_error($q$UPDATE public.lms_submissions SET status = 'submitted' WHERE id = '5b000000-0000-0000-0000-000000000002'$q$, '23514', 'late draft submit accepted with allow_late=false');
-- PASS: delete own draft.
SELECT public.expect_rows($q$DELETE FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000002'$q$, 1, 'S1 could not delete own draft');

-- FAIL: students never write grades.
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000001', 10)$q$, '42501', 'S1 graded own attempt');
-- FAIL: grading roster is empty for a student.
SELECT public.expect_count($q$SELECT * FROM public.lms_grading_roster('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48')$q$, 0, 'S1 read the grading roster');
-- PASS: reads own attempts and own storage object.
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 2, 'S1 should read own 2 attempts');
SELECT public.expect_count('SELECT 1 FROM storage.objects', 1, 'S1 should read own object');
RESET ROLE;

-- ── S2: sees nothing of S1 ────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33343334-3334-3334-3334-333433343334', false);
-- FAIL: other student's rows.
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 0, 'S2 read S1 submissions');
SELECT public.expect_count('SELECT 1 FROM public.lms_submission_files', 0, 'S2 read S1 files');
SELECT public.expect_count('SELECT 1 FROM public.lms_grades', 0, 'S2 read grades');
SELECT public.expect_count('SELECT 1 FROM public.lms_current_submissions', 0, 'S2 read current submissions');
SELECT public.expect_count('SELECT 1 FROM storage.objects', 0, 'S2 read S1 object');
-- PASS: own draft on AS1.
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, body_text)
VALUES ('5b000000-0000-0000-0000-000000000022', 'a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000002', 'S2 draft');
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 1, 'S2 should read own draft');
RESET ROLE;

-- ── Staff of A: grade and release ─────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
-- PASS: published assignments; submitted attempts (not S2's draft); files; objects; roster.
SELECT public.expect_count('SELECT 1 FROM public.lms_assignments', 3, 'staff A should see 3 published assignments');
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 2, 'staff A should see 2 submitted attempts');
SELECT public.expect_count($q$SELECT 1 FROM public.lms_submissions WHERE status = 'draft'$q$, 0, 'staff A read a draft');
SELECT public.expect_count('SELECT 1 FROM public.lms_submission_files', 9, 'staff A should see 9 files');
SELECT public.expect_count('SELECT 1 FROM storage.objects', 1, 'staff A should see the object');
SELECT public.expect_count($q$SELECT * FROM public.lms_grading_roster('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48')$q$, 2, 'staff A roster should list 2 students');
-- FAIL: staff cannot edit assignments.
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, title, max_points) VALUES ('c1000000-0000-0000-0000-000000000001', 'staff made', 5)$q$, '42501', 'staff created an assignment');
SELECT public.expect_rows($q$UPDATE public.lms_assignments SET title = 'renamed' WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, 0, 'staff edited an assignment');
SELECT public.expect_rows($q$DELETE FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, 0, 'staff deleted an assignment');
-- FAIL: points out of bounds, grading a draft.
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000001', 11)$q$, '23514', 'points above max accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000001', -1)$q$, '23514', 'negative points accepted');
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000022', 5)$q$, NULL, 'staff graded a draft (trigger 23514 fires before RLS)');
-- PASS: grade attempt 1 (8/10), unreleased.
INSERT INTO public.lms_grades (id, submission_id, points, feedback)
VALUES ('6a000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 8, 'Good work');
DO $$
BEGIN
  IF (SELECT graded_by FROM public.lms_grades WHERE id = '6a000000-0000-0000-0000-000000000001') <> '22222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'FAIL: graded_by not stamped';
  END IF;
END $$;
RESET ROLE;

-- Unreleased grade is invisible to S1.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
SELECT public.expect_count('SELECT 1 FROM public.lms_grades', 0, 'S1 saw an unreleased grade');
RESET ROLE;

-- Staff of A releases.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT public.expect_rows($q$UPDATE public.lms_grades SET released_at = now() WHERE id = '6a000000-0000-0000-0000-000000000001'$q$, 1, 'staff could not release');
DO $$
BEGIN
  IF (SELECT released_by FROM public.lms_grades WHERE id = '6a000000-0000-0000-0000-000000000001') <> '22222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'FAIL: released_by not stamped';
  END IF;
END $$;
-- FAIL: only editors delete grades.
SELECT public.expect_rows($q$DELETE FROM public.lms_grades WHERE id = '6a000000-0000-0000-0000-000000000001'$q$, 0, 'staff deleted a grade');
RESET ROLE;

-- S1 now sees the released grade; still cannot change it.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
SELECT public.expect_count('SELECT 1 FROM public.lms_grades', 1, 'S1 should see the released grade');
SELECT public.expect_rows($q$UPDATE public.lms_grades SET points = 10$q$, 0, 'S1 updated a grade');
SELECT public.expect_rows($q$DELETE FROM public.lms_grades$q$, 0, 'S1 deleted a grade');

-- Resubmit after release → attempt 2 (direct submit, no draft).
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, status, body_text)
VALUES ('5b000000-0000-0000-0000-000000000003', 'a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'Second try');
DO $$
BEGIN
  IF (SELECT attempt_no FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'FAIL: resubmission is not attempt 2';
  END IF;
  IF (SELECT id FROM public.lms_current_submissions WHERE assignment_id = 'a5000000-0000-0000-0000-000000000001') <> '5b000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'FAIL: attempt 2 is not current';
  END IF;
  -- Attempt 1 and its grade stay readable and unchanged.
  IF (SELECT body_text FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000001') <> 'My answer' THEN
    RAISE EXCEPTION 'FAIL: attempt 1 changed';
  END IF;
  IF (SELECT points FROM public.lms_grades WHERE submission_id = '5b000000-0000-0000-0000-000000000001') <> 8 THEN
    RAISE EXCEPTION 'FAIL: attempt 1 grade not readable after attempt 2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lms_grades WHERE submission_id = '5b000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'FAIL: attempt 2 already graded';
  END IF;
END $$;
RESET ROLE;

-- Staff of A: attempt-1 grade frozen; attempt 2 graded separately.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT public.expect_error($q$UPDATE public.lms_grades SET points = 9 WHERE id = '6a000000-0000-0000-0000-000000000001'$q$, '23514', 'superseded grade changed');
INSERT INTO public.lms_grades (id, submission_id, points, feedback, released_at)
VALUES ('6a000000-0000-0000-0000-000000000003', '5b000000-0000-0000-0000-000000000003', 10, 'Better', now());
SELECT public.expect_count($q$SELECT 1 FROM public.lms_current_submissions WHERE enrollment_id = 'e5000000-0000-0000-0000-000000000001'$q$, 2, 'staff current view should show AS1 #2 and AS4 #1');
RESET ROLE;

-- ── Staff of B: nothing in A ──────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
-- PASS: own school's published assignment.
SELECT public.expect_count('SELECT 1 FROM public.lms_assignments', 1, 'staff B should see ASB only');
-- FAIL: A's submissions, files, grades, objects, roster; grading A.
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 0, 'staff B read A submissions');
SELECT public.expect_count('SELECT 1 FROM public.lms_submission_files', 0, 'staff B read A files');
SELECT public.expect_count('SELECT 1 FROM public.lms_grades', 0, 'staff B read A grades');
SELECT public.expect_count('SELECT 1 FROM storage.objects', 0, 'staff B read A objects');
SELECT public.expect_count($q$SELECT * FROM public.lms_grading_roster('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48')$q$, 0, 'staff B read A roster');
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000004', 5)$q$, '42501', 'staff B graded an A attempt');
SELECT public.expect_rows($q$UPDATE public.lms_grades SET released_at = now()$q$, 0, 'staff B released an A grade');
RESET ROLE;

-- ── Leader of A: full editor ──────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
-- PASS: sees all 4 A assignments incl. draft; create, publish, edit.
SELECT public.expect_count('SELECT 1 FROM public.lms_assignments', 4, 'leader A should see 4 assignments');
INSERT INTO public.lms_assignments (id, course_id, title, max_points, submission_types, created_by)
VALUES ('a5000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000001', 'Leader made', 20, ARRAY['text','file'], '11111111-1111-1111-1111-111111111111');
SELECT public.expect_rows($q$UPDATE public.lms_assignments SET published = true WHERE id = 'a5000000-0000-0000-0000-000000000009'$q$, 1, 'leader could not publish');
-- PASS: leader grades and releases (AS4 attempt).
INSERT INTO public.lms_grades (submission_id, points, feedback) VALUES ('5b000000-0000-0000-0000-000000000004', 6, 'Late but fine');
SELECT public.expect_rows($q$UPDATE public.lms_grades SET released_at = now() WHERE submission_id = '5b000000-0000-0000-0000-000000000004'$q$, 1, 'leader could not release');
-- FAIL: max_points below an existing grade; delete a superseded grade;
-- delete an assignment that has grades (RESTRICT).
SELECT public.expect_error($q$UPDATE public.lms_assignments SET max_points = 5 WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, '23514', 'max_points dropped below a grade');
SELECT public.expect_error($q$DELETE FROM public.lms_grades WHERE id = '6a000000-0000-0000-0000-000000000001'$q$, '23514', 'leader deleted a superseded grade');
SELECT public.expect_error($q$DELETE FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, '23503', 'graded assignment deleted');
-- FAIL: leader cannot touch a student's submitted attempt either.
SELECT public.expect_rows($q$UPDATE public.lms_submissions SET body_text = 'x' WHERE id = '5b000000-0000-0000-0000-000000000003'$q$, 0, 'leader edited a submitted attempt');
-- FAIL: program B content.
SELECT public.expect_error($q$INSERT INTO public.lms_assignments (course_id, title, max_points) VALUES ('cb000000-0000-0000-0000-00000000000b', 'x', 5)$q$, '42501', 'leader A created in program B');
-- F4: client created_by / created_at are ignored on insert and frozen on update.
INSERT INTO public.lms_assignments (id, course_id, title, max_points, created_by, created_at)
VALUES ('a5000000-0000-0000-0000-00000000000f', 'c1000000-0000-0000-0000-000000000001', 'Spoofed', 5,
        '77777777-7777-7777-7777-777777777777', '2000-01-01T00:00:00Z');
UPDATE public.lms_assignments SET created_by = '77777777-7777-7777-7777-777777777777', created_at = '2000-01-01T00:00:00Z'
 WHERE id = 'a5000000-0000-0000-0000-00000000000f';
DO $$
BEGIN
  IF (SELECT created_by FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-00000000000f') <> '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'FAIL: client created_by was kept';
  END IF;
  IF (SELECT created_at FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-00000000000f') < '2020-01-01' THEN
    RAISE EXCEPTION 'FAIL: client created_at was kept';
  END IF;
END $$;
RESET ROLE;

-- ── F2: submitted attempts survive assignment / course deletes ──
-- AS6 has a submitted, ungraded attempt (S2); AS7 only a draft (S2).
INSERT INTO public.lms_assignments (id, course_id, title, max_points, published) VALUES
  ('a5000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000001', 'AS6', 10, true),
  ('a5000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000001', 'AS7', 10, true);
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, status, body_text) VALUES
  ('5b000000-0000-0000-0000-000000000006', 'a5000000-0000-0000-0000-000000000006', 'e5000000-0000-0000-0000-000000000002', 'submitted', 'S2 work'),
  ('5b000000-0000-0000-0000-000000000007', 'a5000000-0000-0000-0000-000000000007', 'e5000000-0000-0000-0000-000000000002', 'draft', 'S2 draft');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
-- FAIL: an ungraded submitted attempt blocks the assignment and course delete.
SELECT public.expect_error($q$DELETE FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-000000000006'$q$, '23503', 'assignment with a submitted ungraded attempt deleted');
SELECT public.expect_error($q$DELETE FROM public.lms_courses WHERE id = 'c1000000-0000-0000-0000-000000000001'$q$, '23503', 'course with submitted work deleted');
-- PASS: an assignment with only a draft can go; the draft cascades.
SELECT public.expect_rows($q$DELETE FROM public.lms_assignments WHERE id = 'a5000000-0000-0000-0000-000000000007'$q$, 1, 'draft-only assignment not deleted');
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000006') THEN
    RAISE EXCEPTION 'FAIL: submitted attempt was cascaded away';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000007') THEN
    RAISE EXCEPTION 'FAIL: draft did not cascade with its assignment';
  END IF;
END $$;

-- ── Leader of B: nothing in A ─────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
SELECT public.expect_count('SELECT 1 FROM public.lms_assignments', 1, 'leader B should see ASB only');
SELECT public.expect_count('SELECT 1 FROM public.lms_submissions', 0, 'leader B read A submissions');
SELECT public.expect_rows($q$UPDATE public.lms_assignments SET title = 'x' WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, 0, 'leader B edited an A assignment');
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000004', 1)$q$, '42501', 'leader B graded an A attempt');
RESET ROLE;

-- ── F1: program_leader ROLE scoped to B (9999) ────────────
-- Fails on the unscoped helper chain; passes once 310 redefines lms_can_edit.
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, status, body_text)
VALUES ('5b000000-0000-0000-0000-00000000000b', 'a5000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-000000000003', 'submitted', 'S3 work');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
-- FAIL: nothing of school A.
SELECT public.expect_count($q$SELECT 1 FROM public.lms_assignments WHERE course_id = 'c1000000-0000-0000-0000-000000000001'$q$, 0, 'B-scoped role read A assignments');
SELECT public.expect_count($q$SELECT 1 FROM public.lms_submissions WHERE enrollment_id IN ('e5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000002')$q$, 0, 'B-scoped role read A submissions');
SELECT public.expect_count($q$SELECT 1 FROM public.lms_submission_files$q$, 0, 'B-scoped role read A files');
SELECT public.expect_count($q$SELECT 1 FROM public.lms_grades$q$, 0, 'B-scoped role read A grades');
SELECT public.expect_count($q$SELECT 1 FROM storage.objects$q$, 0, 'B-scoped role read A storage objects');
SELECT public.expect_count($q$SELECT * FROM public.lms_grading_roster('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48')$q$, 0, 'B-scoped role read A roster');
SELECT public.expect_rows($q$UPDATE public.lms_assignments SET title = 'hijack' WHERE id = 'a5000000-0000-0000-0000-000000000001'$q$, 0, 'B-scoped role edited an A assignment');
SELECT public.expect_rows($q$UPDATE public.lms_grades SET points = 0$q$, 0, 'B-scoped role edited an A grade');
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000006', 1)$q$, '42501', 'B-scoped role graded an A attempt');
SELECT public.expect_rows($q$UPDATE public.lms_courses SET title = 'hijack' WHERE id = 'c1000000-0000-0000-0000-000000000001'$q$, 0, 'B-scoped role edited an A course (305 leak)');
-- PASS: school B, where the role is scoped.
SELECT public.expect_count($q$SELECT * FROM public.lms_grading_roster('44444444-0000-0000-0000-444444444444')$q$, 1, 'B-scoped role should see the B roster');
SELECT public.expect_rows($q$UPDATE public.lms_assignments SET title = 'B work v2' WHERE id = 'a5000000-0000-0000-0000-00000000000b'$q$, 1, 'B-scoped role could not edit a B assignment');
INSERT INTO public.lms_assignments (course_id, title, max_points) VALUES ('cb000000-0000-0000-0000-00000000000b', 'Role-made', 5);
INSERT INTO public.lms_grades (submission_id, points, feedback, released_at)
VALUES ('5b000000-0000-0000-0000-00000000000b', 4, 'B grade', now());
SELECT public.expect_count($q$SELECT 1 FROM public.lms_grades$q$, 1, 'B-scoped role should see the B grade');
RESET ROLE;

-- ── Late resubmission with allow_late=false (owner moves the date) ──
UPDATE public.lms_assignments SET due_at = now() + interval '1 day' WHERE id = 'a5000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status, body_text)
VALUES ('a5000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'on time');
RESET ROLE;
UPDATE public.lms_assignments SET due_at = now() - interval '1 minute' WHERE id = 'a5000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
SELECT public.expect_error($q$INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status, body_text) VALUES ('a5000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'late resubmit')$q$, '23514', 'late resubmission accepted with allow_late=false');
RESET ROLE;

-- ── F5: submit needs content of an accepted type ──────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status)
    VALUES ('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'submitted');
    RAISE EXCEPTION 'FAIL: empty submit accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'empty_submission:%' THEN
      RAISE EXCEPTION 'FAIL: empty submit raised % instead of empty_submission', SQLERRM;
    END IF;
  END;
  BEGIN
    -- AS4 takes text only; a link alone is not an accepted type.
    INSERT INTO public.lms_submissions (assignment_id, enrollment_id, status, link_url)
    VALUES ('a5000000-0000-0000-0000-000000000004', 'e5000000-0000-0000-0000-000000000001', 'submitted', 'https://example.org');
    RAISE EXCEPTION 'FAIL: link-only submit accepted on a text-only assignment';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'empty_submission:%' THEN
      RAISE EXCEPTION 'FAIL: link-only submit raised % instead of empty_submission', SQLERRM;
    END IF;
  END;
END $$;
-- PASS: a file-only attempt on a file assignment (AS9: text, file); F4 on submissions.
INSERT INTO public.lms_submissions (id, assignment_id, enrollment_id, created_at)
VALUES ('5b000000-0000-0000-0000-000000000009', 'a5000000-0000-0000-0000-000000000009', 'e5000000-0000-0000-0000-000000000001', '2000-01-01T00:00:00Z');
INSERT INTO public.lms_submission_files (submission_id, storage_path, file_name, mime, size_bytes) VALUES
  ('5b000000-0000-0000-0000-000000000009',
   '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/a5000000-0000-0000-0000-000000000009/5b000000-0000-0000-0000-000000000009/0f0f0f0f-0000-4000-8000-000000000909.pdf',
   'only.pdf', 'application/pdf', 100);
SELECT public.expect_rows($q$UPDATE public.lms_submissions SET status = 'submitted' WHERE id = '5b000000-0000-0000-0000-000000000009'$q$, 1, 'file-only submit refused');
DO $$
BEGIN
  IF (SELECT created_at FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000009') < '2020-01-01' THEN
    RAISE EXCEPTION 'FAIL: client created_at kept on a submission';
  END IF;
END $$;
RESET ROLE;

-- ── F3: no self-grading (S2 becomes staff of A) ───────────
INSERT INTO public.program_staff (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33343334-3334-3334-3334-333433343334');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33343334-3334-3334-3334-333433343334', false);
-- FAIL: grade own attempt (AS6).
SELECT public.expect_error($q$INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000006', 10)$q$, '42501', 'staff graded their own attempt');
-- PASS: grade someone else's (S1's on-time AS2 attempt).
SELECT public.expect_rows($q$INSERT INTO public.lms_grades (submission_id, points)
  SELECT id, 5 FROM public.lms_submissions
   WHERE assignment_id = 'a5000000-0000-0000-0000-000000000002'
     AND enrollment_id = 'e5000000-0000-0000-0000-000000000001'
     AND status = 'submitted'$q$, 1, 'staff S2 could not grade S1');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
INSERT INTO public.lms_grades (submission_id, points) VALUES ('5b000000-0000-0000-0000-000000000006', 7);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33343334-3334-3334-3334-333433343334', false);
-- FAIL: update own grade.
SELECT public.expect_rows($q$UPDATE public.lms_grades SET points = 10 WHERE submission_id = '5b000000-0000-0000-0000-000000000006'$q$, 0, 'staff edited their own grade');
RESET ROLE;

-- ── Owner-level backstops ─────────────────────────────────
-- Submitted rows are immutable even without RLS.
SELECT public.expect_error($q$UPDATE public.lms_submissions SET body_text = 'owner edit' WHERE id = '5b000000-0000-0000-0000-000000000001'$q$, '23514', 'owner edited a submitted attempt');
SELECT public.expect_error($q$DELETE FROM public.lms_submissions WHERE id = '5b000000-0000-0000-0000-000000000004'$q$, '23514', 'owner deleted a submitted attempt');
-- Enrolment delete is held by RESTRICT.
SELECT public.expect_error($q$DELETE FROM public.enrollments WHERE id = 'e5000000-0000-0000-0000-000000000001'$q$, '23503', 'enrolment with work deleted');
-- Bucket is private.
DO $$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'lms-submissions') THEN
    RAISE EXCEPTION 'FAIL: lms-submissions bucket is public';
  END IF;
END $$;

SELECT 'lms_assignments_rls: all checks passed' AS result;
