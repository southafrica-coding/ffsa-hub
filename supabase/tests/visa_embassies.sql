-- Disposable check for migration 500 (embassies and FFSA's standing
-- documents). Not a migration. Same stubs as visa_letters.sql, then:
-- only global legal keeps embassies and standing documents; the student
-- picks the embassy until approval, legal until lodging; students reach
-- only the standing documents marked for them, only while approved or
-- lodged, and each download is logged.
--
--   dropdb --if-exists visa_embassies && createdb visa_embassies
--   psql -v ON_ERROR_STOP=1 -d visa_embassies -f supabase/tests/visa_embassies.sql



DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;  -- as in Supabase

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

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
  SELECT (required_permission || ':*') = ANY (
           string_to_array(coalesce(current_setting('test.scoped', true), ''), ',')
         )
      OR (required_permission || ':' || target_program_id::text) = ANY (
           string_to_array(coalesce(current_setting('test.scoped', true), ''), ',')
         );
$$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  first_name text, last_name text, gender text, nationality text,
  passport_country text, passport_number text
);
CREATE TABLE public.programs (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.billing_courses (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES public.programs(id)
);
CREATE TABLE public.application_responses (id uuid PRIMARY KEY);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

-- Supabase's default ACL grants service_role ALL on new tables; 361 must
-- still leave the event log append-only for it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql
\ir ../migrations/363_visa_workflow.sql
-- Re-running must not fail or duplicate anything.
\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql
\ir ../migrations/363_visa_workflow.sql
\ir ../migrations/366_visa_letters.sql
\ir ../migrations/500_visa_embassies.sql
\ir ../migrations/500_visa_embassies.sql

GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;

-- ── Seed: schools A and B; legal 1, leader of A 2, legal scoped to B 3,
--    student 4 (case 1, approved), student 5 (case 2, still collecting),
--    outsider 7 ──
INSERT INTO public.programs (id, name) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'School A'),
  ('b0000000-0000-0000-0000-00000000000b', 'School B');
INSERT INTO public.users (id, first_name, last_name, gender, nationality, passport_number) VALUES
  ('00000000-0000-0000-0000-000000000001', 'L', 'One', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000002', 'Lead', 'Two', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000003', 'L', 'Three', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000004', 'Test', 'Student', 'Female', 'Testland', 'XT1234567'),
  ('00000000-0000-0000-0000-000000000005', 'Other', 'Student', 'Male', 'Testland', 'XT7654321'),
  ('00000000-0000-0000-0000-000000000007', 'Out', 'Sider', NULL, NULL, NULL);
INSERT INTO public.visa_cases (id, user_id, status, waiting_on, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'approved', 'student', '2027-01-10', '2027-04-08'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'collecting_documents', 'student', '2027-01-10', '2027-04-08');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a');


CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text, p_admin text, p_perms text, p_scoped text)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid, false),
         set_config('test.admin', p_admin, false),
         set_config('test.perms', p_perms, false),
         set_config('test.scoped', p_scoped, false);
$$;
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION pg_temp.expect_text(label text, got text, want text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want;
  END IF;
END;
$$;
-- Runs a statement and requires it to fail with the given SQLSTATE.
CREATE OR REPLACE FUNCTION pg_temp.refused(label text, stmt text, want_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL %: was allowed', label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
  IF SQLSTATE <> want_state THEN
    RAISE EXCEPTION 'FAIL %: got % (%), want %', label, SQLSTATE, SQLERRM, want_state;
  END IF;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

CREATE OR REPLACE FUNCTION pg_temp.as_legal() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_leader() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                         'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_legal_b() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000003', 'false',
                         'visas.manage', 'visas.manage:b0000000-0000-0000-0000-00000000000b');
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_student() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;


CREATE OR REPLACE FUNCTION pg_temp.as_outsider() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', '', '');
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_student2() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000005', 'false', '', '');
$$;
CREATE OR REPLACE FUNCTION pg_temp.doc(p_label text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.visa_standing_documents WHERE label = p_label;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

-- ── Seed ran once, twice applied ─────────────────────────
SELECT pg_temp.expect('six standing documents seeded once',
  (SELECT count(*) FROM public.visa_standing_documents), 6);

-- ── Embassies: everyone reads, only global legal writes ──
SELECT pg_temp.as_legal();
SET ROLE authenticated;
INSERT INTO public.visa_embassies (id, country_iso, name, city, addressee, processing_weeks)
VALUES ('e0000000-0000-0000-0000-000000000001', 'TL', 'South African High Commission', 'Testville', 'The High Commissioner', 6),
       ('e0000000-0000-0000-0000-000000000002', 'TL', 'South African Consulate', 'Other City', 'The Consul-General', NULL);
SELECT pg_temp.refused('the same mission twice',
  $q$INSERT INTO public.visa_embassies (country_iso, name, city) VALUES ('TL', 'south african high commission ', 'TESTVILLE')$q$, '23505');
SELECT pg_temp.refused('a link that isn''t https',
  $q$INSERT INTO public.visa_embassies (country_iso, name, city, website_url) VALUES ('TL', 'X', 'Y', 'http://example.org')$q$, '23514');
UPDATE public.visa_embassies SET is_active = false WHERE id = 'e0000000-0000-0000-0000-000000000002';
SELECT pg_temp.refused('legal deletes an embassy',
  $q$DELETE FROM public.visa_embassies WHERE id = 'e0000000-0000-0000-0000-000000000002'$q$, '42501');
RESET ROLE;

SELECT pg_temp.as_legal_b();
SET ROLE authenticated;
SELECT pg_temp.refused('legal scoped to one school adds an embassy',
  $q$INSERT INTO public.visa_embassies (country_iso, name, city) VALUES ('TL', 'X', 'Y')$q$, '42501');
UPDATE public.visa_embassies SET city = 'Hacked';
SELECT pg_temp.expect('scoped legal changes no embassy',
  (SELECT count(*) FROM public.visa_embassies WHERE city = 'Hacked'), 0);
RESET ROLE;

SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.expect('a student reads the embassies', (SELECT count(*) FROM public.visa_embassies), 2);
SELECT pg_temp.refused('a student adds an embassy',
  $q$INSERT INTO public.visa_embassies (country_iso, name, city) VALUES ('TL', 'X', 'Y')$q$, '42501');
RESET ROLE;

-- ── The case's embassy ───────────────────────────────────
-- Student 5's case is still collecting documents: they choose.
SELECT pg_temp.as_student2();
SET ROLE authenticated;
SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001');
SELECT pg_temp.refused('a retired embassy',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002')$q$, 'P0001');
SELECT pg_temp.refused('someone else''s case',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;
SELECT pg_temp.expect_text('the student''s choice is saved',
  (SELECT embassy_id::text FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000002'),
  'e0000000-0000-0000-0000-000000000001');

-- Student 4's case is approved: only legal changes it now.
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.refused('the student changes it after approval',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$q$, 'P0001');
RESET ROLE;
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.refused('a school leader sets it',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_outsider();
SET ROLE authenticated;
SELECT pg_temp.refused('an outsider sets it',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001');
RESET ROLE;
UPDATE public.visa_cases SET status = 'lodged' WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('legal changes it after lodging',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000001', NULL)$q$, 'P0001');
RESET ROLE;
SELECT pg_temp.expect('each change is logged',
  (SELECT count(*) FROM public.visa_case_events WHERE kind = 'embassy_set'), 2);

-- ── Standing documents: global legal only ────────────────
SELECT pg_temp.as_legal_b();
SET ROLE authenticated;
SELECT pg_temp.expect('scoped legal reads none', (SELECT count(*) FROM public.visa_standing_documents), 0);
SELECT pg_temp.refused('scoped legal adds one',
  $q$INSERT INTO public.visa_standing_documents (label) VALUES ('X')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.expect('a leader reads none', (SELECT count(*) FROM public.visa_standing_documents), 0);
RESET ROLE;

SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.expect('legal reads them all', (SELECT count(*) FROM public.visa_standing_documents), 6);
SELECT pg_temp.refused('the same label twice',
  $q$INSERT INTO public.visa_standing_documents (label) VALUES ('npo certificate')$q$, '23505');
SELECT pg_temp.refused('for students without a file',
  $q$UPDATE public.visa_standing_documents SET for_students = true WHERE id = pg_temp.doc('NPO certificate')$q$, '23514');
SELECT pg_temp.refused('a file at another row''s path',
  $q$UPDATE public.visa_standing_documents SET storage_path = 'standing/' || pg_temp.doc('Proof of address') || '.pdf', mime_type = 'application/pdf'
      WHERE id = pg_temp.doc('NPO certificate')$q$, '23514');
SELECT pg_temp.refused('a file in a student''s folder',
  $q$UPDATE public.visa_standing_documents SET storage_path = 'c0000000-0000-0000-0000-000000000001/x.pdf', mime_type = 'application/pdf'
      WHERE id = pg_temp.doc('NPO certificate')$q$, '23514');
UPDATE public.visa_standing_documents
   SET storage_path = 'standing/' || id || '.pdf', mime_type = 'application/pdf', for_students = true
 WHERE label = 'NPO certificate';
UPDATE public.visa_standing_documents
   SET storage_path = 'standing/' || id || '.jpg', mime_type = 'image/jpeg', certified_on = '2026-10-01', renew_months = 3
 WHERE label = 'Certified copy of legal''s ID';
SELECT pg_temp.refused('legal deletes one',
  $q$DELETE FROM public.visa_standing_documents WHERE label = 'NPO certificate'$q$, '42501');
SELECT pg_temp.expect_text('legal gets any file',
  public.visa_standing_document_path(pg_temp.doc('Certified copy of legal''s ID')),
  'standing/' || pg_temp.doc('Certified copy of legal''s ID') || '.jpg');
RESET ROLE;

-- Student 4 (case lodged): only the document marked for students.
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.expect('the student reads the list through the function only',
  (SELECT count(*) FROM public.visa_standing_documents), 0);
SELECT pg_temp.expect('one document for the student',
  (SELECT count(*) FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000001')), 1);
SELECT pg_temp.expect_text('the student gets its file',
  public.visa_standing_document_path(
    (SELECT id FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000001')),
    'c0000000-0000-0000-0000-000000000001'),
  (SELECT 'standing/' || id || '.pdf' FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000001')));
SELECT pg_temp.refused('no document named',
  $q$SELECT public.visa_standing_document_path(
       (SELECT id FROM public.visa_embassies LIMIT 0), 'c0000000-0000-0000-0000-000000000001')$q$, 'P0002');
RESET ROLE;
-- (The student can't name the ID's id from their side; check it directly.)
CREATE TEMP TABLE id_doc AS SELECT pg_temp.doc('Certified copy of legal''s ID') AS id;
GRANT SELECT ON id_doc TO authenticated;
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.refused('the student asks for legal''s ID',
  $q$SELECT public.visa_standing_document_path((SELECT id FROM id_doc), 'c0000000-0000-0000-0000-000000000001')$q$, '42501');
SELECT pg_temp.refused('the student asks without a case',
  $q$SELECT public.visa_standing_document_path((SELECT id FROM id_doc))$q$, '42501');
SELECT pg_temp.refused('the student lists another case''s documents',
  $q$SELECT * FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000002')$q$, '42501');
RESET ROLE;
SELECT pg_temp.expect('the download is logged on the case',
  (SELECT count(*) FROM public.visa_case_events
    WHERE kind = 'standing_document_downloaded' AND case_id = 'c0000000-0000-0000-0000-000000000001'), 1);

-- Student 5 (still collecting documents): nothing yet.
SELECT pg_temp.as_student2();
SET ROLE authenticated;
SELECT pg_temp.expect('nothing before approval',
  (SELECT count(*) FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000002')), 0);
RESET ROLE;
CREATE TEMP TABLE npo_doc AS SELECT pg_temp.doc('NPO certificate') AS id;
GRANT SELECT ON npo_doc TO authenticated;
SELECT pg_temp.as_student2();
SET ROLE authenticated;
SELECT pg_temp.refused('a file before approval',
  $q$SELECT public.visa_standing_document_path((SELECT id FROM npo_doc), 'c0000000-0000-0000-0000-000000000002')$q$, '42501');
RESET ROLE;

-- After the case is granted the list is gone again.
UPDATE public.visa_cases SET status = 'granted' WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.expect('nothing once granted',
  (SELECT count(*) FROM public.visa_case_standing_documents('c0000000-0000-0000-0000-000000000001')), 0);
RESET ROLE;

-- anon can run none of the functions.
SET ROLE anon;
SELECT pg_temp.refused('anon sets an embassy',
  $q$SELECT public.visa_set_case_embassy('c0000000-0000-0000-0000-000000000002', NULL)$q$, '42501');
SELECT pg_temp.refused('anon reads embassies',
  $q$SELECT count(*) FROM public.visa_embassies$q$, '42501');
RESET ROLE;

\echo 'visa_embassies: all checks passed'
