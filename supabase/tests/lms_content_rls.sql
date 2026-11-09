-- Disposable RLS check for migration 305 (schools LMS content). Not a migration.
-- Stubs the helpers 305 calls (auth.uid, has_schools_access,
-- can_manage_program_applications, is_program_staff, handle_updated_at),
-- applies 305 twice, then reads and writes as each kind of user.
--
--   dropdb --if-exists lms_content_rls && createdb lms_content_rls
--   psql -v ON_ERROR_STOP=1 -d lms_content_rls -f supabase/tests/lms_content_rls.sql
--
-- People (program A = 5ca7…, program B = 4444…):
--   1111 leader of A         2222 staff of A
--   3333 enrolled in A       4444 dismissed from A
--   5555 removed from A      6666 outsider
--   7777 leader of B

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
GRANT USAGE ON SCHEMA public TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('test.admin', true) = 'true';
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT required_permission = ANY (
    string_to_array(coalesce(current_setting('test.perms', true), ''), ',')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission_for(required_permission text, target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.has_permission(required_permission);
$$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
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

-- Same shape as migrations 145 / 304, with the permission tables stubbed.
CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_admin()
      OR public.has_permission_for('schools.manage', target_program_id)
      OR EXISTS (
        SELECT 1 FROM public.program_leaders
        WHERE program_id = target_program_id AND user_id = auth.uid()
      );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_program_applications(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.has_schools_access(target_program_id)
      OR public.has_permission_for('schools.approve_applications', target_program_id)
      OR public.has_permission_for('schools.manage_enrollments', target_program_id);
$$;

CREATE OR REPLACE FUNCTION public.is_program_staff(target_program_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.program_staff
    WHERE program_id = target_program_id AND user_id = auth.uid()
  );
$$;

\ir ../migrations/305_schools_lms_content.sql
-- Re-running must not fail or duplicate policies.
\ir ../migrations/305_schools_lms_content.sql

-- ── Seed (as the owner, so RLS does not apply) ────────────
INSERT INTO public.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444'),
  ('55555555-5555-5555-5555-555555555555'),
  ('66666666-6666-6666-6666-666666666666'),
  ('77777777-7777-7777-7777-777777777777');
INSERT INTO public.programs (id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'),
  ('44444444-0000-0000-0000-444444444444');
INSERT INTO public.program_leaders (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '11111111-1111-1111-1111-111111111111'),
  ('44444444-0000-0000-0000-444444444444', '77777777-7777-7777-7777-777777777777');
INSERT INTO public.program_staff (program_id, user_id) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.enrollments (program_id, user_id, status, removed_at) VALUES
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '33333333-3333-3333-3333-333333333333', 'arrived', NULL),
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '44444444-4444-4444-4444-444444444444', 'dismissed', NULL),
  ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '55555555-5555-5555-5555-555555555555', 'arrived', now());

-- Program A: course C1 published, C2 draft.
--   C1 → module M1 published (lessons L1 published, L2 draft)
--        module M2 draft     (lesson L3 published — hidden by its module)
--   C2 → module M3 published (lesson L4 published — hidden by its course)
-- Program B: course CB published → MB published → LB published.
INSERT INTO public.lms_courses (id, program_id, title, sort_order, published) VALUES
  ('c1000000-0000-0000-0000-000000000001', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'C1', 0, true),
  ('c2000000-0000-0000-0000-000000000002', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'C2', 1, false),
  ('cb000000-0000-0000-0000-00000000000b', '44444444-0000-0000-0000-444444444444', 'CB', 0, true);
INSERT INTO public.lms_modules (id, course_id, title, sort_order, published) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'M1', 0, true),
  ('a2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'M2', 1, false),
  ('a3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 'M3', 0, true),
  ('ab000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-00000000000b', 'MB', 0, true);
INSERT INTO public.lms_lessons (id, module_id, title, content_type, body, link_url, sort_order, published) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'L1', 'rich_text', 'Hello', NULL, 0, true),
  ('e2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'L2', 'link', NULL, 'https://example.org', 1, false),
  ('e3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'L3', 'rich_text', 'Draft module', NULL, 0, true),
  ('e4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003', 'L4', 'rich_text', 'Draft course', NULL, 0, true),
  ('eb000000-0000-0000-0000-00000000000b', 'ab000000-0000-0000-0000-00000000000b', 'LB', 'rich_text', 'Other school', NULL, 0, true);

-- The content check holds.
DO $$
BEGIN
  INSERT INTO public.lms_lessons (module_id, title, content_type, body)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'No link', 'link', 'body only');
  RAISE EXCEPTION 'a link lesson without link_url was accepted';
EXCEPTION WHEN check_violation THEN
  NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.lms_lessons (module_id, title, content_type, link_url)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'No body', 'rich_text', 'https://x.test');
  RAISE EXCEPTION 'a rich_text lesson without body was accepted';
EXCEPTION WHEN check_violation THEN
  NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.lms_lessons (module_id, title, content_type, body)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'Video', 'video', 'x');
  RAISE EXCEPTION 'an unknown content_type was accepted';
EXCEPTION WHEN check_violation THEN
  NULL;
END $$;

SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);

-- ── anon: no grants at all ────────────────────────────────
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
BEGIN
  PERFORM 1 FROM public.lms_courses;
  RAISE EXCEPTION 'anon read lms_courses';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.lms_lessons;
  RAISE EXCEPTION 'anon read lms_lessons';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
RESET ROLE;

-- ── leader of A: reads drafts, writes, but only in A ──────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.lms_courses) <> 2 THEN
    RAISE EXCEPTION 'leader should see both A courses (incl. draft), got %', (SELECT count(*) FROM public.lms_courses);
  END IF;
  IF (SELECT count(*) FROM public.lms_modules) <> 3 THEN
    RAISE EXCEPTION 'leader should see all 3 A modules';
  END IF;
  IF (SELECT count(*) FROM public.lms_lessons) <> 4 THEN
    RAISE EXCEPTION 'leader should see all 4 A lessons';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lms_courses WHERE title = 'CB') THEN
    RAISE EXCEPTION 'leader of A read a program B course';
  END IF;
END $$;

INSERT INTO public.lms_courses (id, program_id, title, created_by)
VALUES ('c9000000-0000-0000-0000-000000000009', '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'New course', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.lms_modules (id, course_id, title)
VALUES ('a9000000-0000-0000-0000-000000000009', 'c9000000-0000-0000-0000-000000000009', 'New module');
INSERT INTO public.lms_lessons (module_id, title, content_type, link_url)
VALUES ('a9000000-0000-0000-0000-000000000009', 'New link', 'link', 'https://example.org/x');
UPDATE public.lms_courses SET published = true WHERE id = 'c9000000-0000-0000-0000-000000000009';
UPDATE public.lms_modules SET sort_order = 5 WHERE id = 'a9000000-0000-0000-0000-000000000009';

DO $$
BEGIN
  IF NOT (SELECT published FROM public.lms_courses WHERE id = 'c9000000-0000-0000-0000-000000000009') THEN
    RAISE EXCEPTION 'leader could not publish their course';
  END IF;
END $$;

DO $$
BEGIN
  INSERT INTO public.lms_courses (program_id, title)
  VALUES ('44444444-0000-0000-0000-444444444444', 'Wrong school');
  RAISE EXCEPTION 'leader of A created a course in B';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  INSERT INTO public.lms_modules (course_id, title)
  VALUES ('cb000000-0000-0000-0000-00000000000b', 'Wrong school');
  RAISE EXCEPTION 'leader of A added a module to a B course';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  INSERT INTO public.lms_lessons (module_id, title, content_type, body)
  VALUES ('ab000000-0000-0000-0000-00000000000b', 'Wrong school', 'rich_text', 'x');
  RAISE EXCEPTION 'leader of A added a lesson to a B module';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

-- Moving an A row into B fails the WITH CHECK.
DO $$
BEGIN
  UPDATE public.lms_courses SET program_id = '44444444-0000-0000-0000-444444444444'
   WHERE id = 'c9000000-0000-0000-0000-000000000009';
  RAISE EXCEPTION 'leader of A moved a course into B';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  UPDATE public.lms_modules SET course_id = 'cb000000-0000-0000-0000-00000000000b'
   WHERE id = 'a9000000-0000-0000-0000-000000000009';
  RAISE EXCEPTION 'leader of A moved a module into a B course';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

-- Cannot touch B rows at all.
DO $$
BEGIN
  UPDATE public.lms_courses SET title = 'hijacked' WHERE id = 'cb000000-0000-0000-0000-00000000000b';
  IF FOUND THEN RAISE EXCEPTION 'leader of A updated a B course'; END IF;
  DELETE FROM public.lms_lessons WHERE id = 'eb000000-0000-0000-0000-00000000000b';
  IF FOUND THEN RAISE EXCEPTION 'leader of A deleted a B lesson'; END IF;
END $$;

-- Delete cascades.
DELETE FROM public.lms_courses WHERE id = 'c9000000-0000-0000-0000-000000000009';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lms_modules WHERE id = 'a9000000-0000-0000-0000-000000000009') THEN
    RAISE EXCEPTION 'deleting a course left its module';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.lms_lessons WHERE title = 'New link') <> 0 THEN
    RAISE EXCEPTION 'deleting a course left its lesson';
  END IF;
  IF (SELECT title FROM public.lms_courses WHERE id = 'cb000000-0000-0000-0000-00000000000b') <> 'CB' THEN
    RAISE EXCEPTION 'program B course changed';
  END IF;
END $$;

-- ── schools.approve_applications holder: editor (can_manage_program_applications)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
SELECT set_config('test.perms', 'schools.approve_applications', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.lms_lessons WHERE title = 'L2') <> 1 THEN
    RAISE EXCEPTION 'approve_applications holder could not read a draft lesson';
  END IF;
END $$;
SELECT set_config('test.perms', '', false);
RESET ROLE;

-- ── published-only readers: staff and an enrolled student ──
CREATE OR REPLACE FUNCTION pg_temp.assert_published_only(who text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.lms_courses) <> 1
     OR (SELECT title FROM public.lms_courses) <> 'C1' THEN
    RAISE EXCEPTION '% should see only the published A course', who;
  END IF;
  IF (SELECT count(*) FROM public.lms_modules) <> 1
     OR (SELECT title FROM public.lms_modules) <> 'M1' THEN
    RAISE EXCEPTION '% should see only the published module of a published course', who;
  END IF;
  IF (SELECT count(*) FROM public.lms_lessons) <> 1
     OR (SELECT title FROM public.lms_lessons) <> 'L1' THEN
    RAISE EXCEPTION '% should see only L1 (L2 draft, L3 draft module, L4 draft course, LB other school)', who;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_published_only(text) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.assert_cannot_write(who text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.lms_courses (program_id, title)
    VALUES ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', 'nope');
    RAISE EXCEPTION '% created a course', who;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.lms_modules (course_id, title)
    VALUES ('c1000000-0000-0000-0000-000000000001', 'nope');
    RAISE EXCEPTION '% created a module', who;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.lms_lessons (module_id, title, content_type, body)
    VALUES ('a1000000-0000-0000-0000-000000000001', 'nope', 'rich_text', 'x');
    RAISE EXCEPTION '% created a lesson', who;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.lms_courses SET published = true WHERE id = 'c2000000-0000-0000-0000-000000000002';
  IF FOUND THEN RAISE EXCEPTION '% published a draft course', who; END IF;
  UPDATE public.lms_lessons SET title = 'edited' WHERE id = 'e1000000-0000-0000-0000-000000000001';
  IF FOUND THEN RAISE EXCEPTION '% edited a published lesson', who; END IF;
  DELETE FROM public.lms_modules WHERE id = 'a1000000-0000-0000-0000-000000000001';
  IF FOUND THEN RAISE EXCEPTION '% deleted a module', who; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_cannot_write(text) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.assert_sees_nothing(who text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.lms_courses) <> 0
     OR (SELECT count(*) FROM public.lms_modules) <> 0
     OR (SELECT count(*) FROM public.lms_lessons) <> 0 THEN
    RAISE EXCEPTION '% read LMS content', who;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sees_nothing(text) TO authenticated;

SET ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT pg_temp.assert_published_only('program staff');
SELECT pg_temp.assert_cannot_write('program staff');

SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
SELECT pg_temp.assert_published_only('enrolled student');
SELECT pg_temp.assert_cannot_write('enrolled student');

-- ── no access: dismissed, removed, outsider, other school's leader ──
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
SELECT pg_temp.assert_sees_nothing('dismissed student');
SELECT pg_temp.assert_cannot_write('dismissed student');

SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
SELECT pg_temp.assert_sees_nothing('removed student');

SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
SELECT pg_temp.assert_sees_nothing('outsider');
SELECT pg_temp.assert_cannot_write('outsider');

SELECT set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.lms_courses) <> 1
     OR (SELECT title FROM public.lms_courses) <> 'CB' THEN
    RAISE EXCEPTION 'leader of B should see only the B course';
  END IF;
END $$;
SELECT pg_temp.assert_cannot_write('leader of B');

RESET ROLE;

-- Nothing the denied writers tried got through.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.lms_courses WHERE title = 'nope') <> 0
     OR (SELECT published FROM public.lms_courses WHERE id = 'c2000000-0000-0000-0000-000000000002')
     OR (SELECT title FROM public.lms_lessons WHERE id = 'e1000000-0000-0000-0000-000000000001') <> 'L1'
     OR NOT EXISTS (SELECT 1 FROM public.lms_modules WHERE id = 'a1000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'a denied write changed data';
  END IF;
END $$;

\echo 'lms content RLS checks passed'
