-- Disposable RLS check for migrations 360–362 (visas). Not a migration.
-- Stubs the tables and helper functions the migrations call, applies them
-- (twice: they must be re-runnable), then reads and writes as legal, two
-- school leaders scoped to different schools, students, an outsider and
-- anon.
--
--   dropdb --if-exists visa_rls && createdb visa_rls
--   psql -v ON_ERROR_STOP=1 -d visa_rls -f supabase/tests/visa_rls.sql
--
-- Each user is switched with set_config: request.jwt.claim.sub is the
-- auth.uid(), test.admin makes is_admin() true, test.perms is the
-- comma-separated list has_permission() answers yes to, and test.scoped
-- is a comma-separated list of 'key:program-uuid' (or 'key:*' for an
-- unscoped grant) that has_permission_for() answers yes to.


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

CREATE TABLE public.users (id uuid PRIMARY KEY);
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

-- A bucket someone made by hand, public: 361 must make it private.
INSERT INTO storage.buckets (id, name, public) VALUES ('visa-documents', 'visa-documents', true);

\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql
-- Re-running must not fail or duplicate anything.
\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql

GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;

-- ── Seed (as the table owner, bypassing RLS) ─────────────
-- Programs: A (e.g. FFX), B (e.g. Leadership Track).
-- Users: 1 legal, 2 leader of A, 3 leader of B, 4 student on A,
--        5 student on B, 6 student on A and B, 7 outsider.
INSERT INTO public.programs (id, name) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'School A'),
  ('b0000000-0000-0000-0000-00000000000b', 'School B');
INSERT INTO public.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000007');

INSERT INTO public.visa_cases (id, user_id, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', '2027-01-10', '2027-04-08'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', '2027-01-10', '2027-04-08'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', '2027-01-10', '2027-07-30');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b');

INSERT INTO public.visa_case_documents (id, case_id, document_type_id, storage_path, status, uploaded_by)
SELECT 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', t.id,
       'c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-000000000001.pdf',
       'uploaded', '00000000-0000-0000-0000-000000000004'
  FROM public.visa_document_types t WHERE t.code = 'passport';
INSERT INTO public.visa_case_documents (id, case_id, document_type_id, storage_path, status, uploaded_by)
SELECT 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', t.id,
       'c0000000-0000-0000-0000-000000000002/d0000000-0000-0000-0000-000000000002.pdf',
       'uploaded', '00000000-0000-0000-0000-000000000005'
  FROM public.visa_document_types t WHERE t.code = 'passport';
INSERT INTO public.visa_approval_requests (case_id, requested_by, leader_note) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'All in');
INSERT INTO public.visa_case_questions (case_id, asked_by, question) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Past refusal in 2024?');
INSERT INTO public.visa_case_events (case_id, actor_id, kind) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'document_reviewed');
INSERT INTO public.visa_country_rules (country_iso, country_name, exempt_days) VALUES
  ('US', 'United States', 90);

-- ── Helpers ──────────────────────────────────────────────
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

-- ── Table-level checks (owner, before RLS matters) ───────
SELECT pg_temp.expect('document types seeded once', (SELECT count(*) FROM public.visa_document_types), 14);
SELECT pg_temp.expect('short-stay types', (SELECT count(*) FROM public.visa_document_types WHERE needed_up_to_90), 10);
SELECT pg_temp.expect('long-stay types', (SELECT count(*) FROM public.visa_document_types WHERE needed_over_90), 14);
SELECT pg_temp.expect('permission keys once', (SELECT count(*) FROM public.permissions WHERE key LIKE 'visas.%'), 2);
SELECT pg_temp.expect('bucket private', (SELECT count(*) FROM storage.buckets WHERE id = 'visa-documents' AND public = false), 1);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.visa_case_documents (case_id, document_type_id, storage_path, status)
    SELECT 'c0000000-0000-0000-0000-000000000001', id, 'c0000000-0000-0000-0000-000000000001/jane-doe-passport.pdf', 'uploaded'
      FROM public.visa_document_types WHERE code = 'passport';
    RAISE EXCEPTION 'a file name with a person''s name was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A row on case 1 pointing at case 2's file (Jack's cross-school read).
  BEGIN
    INSERT INTO public.visa_case_documents (case_id, document_type_id, storage_path, status)
    SELECT 'c0000000-0000-0000-0000-000000000001', id,
           'c0000000-0000-0000-0000-000000000002/d0000000-0000-0000-0000-000000000002.pdf', 'uploaded'
      FROM public.visa_document_types WHERE code = 'passport';
    RAISE EXCEPTION 'a document pointing at another case''s file was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Right case, but another row's id.
  BEGIN
    INSERT INTO public.visa_case_documents (id, case_id, document_type_id, storage_path, status)
    SELECT 'd0000000-0000-0000-0000-000000000077', 'c0000000-0000-0000-0000-000000000001', id,
           'c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-000000000001.pdf', 'uploaded'
      FROM public.visa_document_types WHERE code = 'passport';
    RAISE EXCEPTION 'a document pointing at another row''s file was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Even the table owner can't repoint an existing row.
  BEGIN
    UPDATE public.visa_case_documents
       SET storage_path = 'c0000000-0000-0000-0000-000000000002/d0000000-0000-0000-0000-000000000002.pdf'
     WHERE id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a document''s file was changed';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.visa_case_documents SET case_id = 'c0000000-0000-0000-0000-000000000002'
     WHERE id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a document moved to another case';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.visa_case_schools SET case_id = 'c0000000-0000-0000-0000-000000000002'
     WHERE case_id = 'c0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a school moved to another case';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Deleting a case with history is refused, for the owner too.
  BEGIN
    DELETE FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a case with history was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.users WHERE id = '00000000-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'deleting a student took their case with it';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_case_documents (case_id, document_type_id, storage_path, status)
    SELECT 'c0000000-0000-0000-0000-000000000001', id,
           'c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-000000000009.pdf', 'ticked'
      FROM public.visa_document_types WHERE code = 'application_form';
    RAISE EXCEPTION 'a ticked step with a file was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_case_documents (case_id, document_type_id, status)
    SELECT 'c0000000-0000-0000-0000-000000000001', id, 'uploaded'
      FROM public.visa_document_types WHERE code = 'passport';
    RAISE EXCEPTION 'an upload without a file was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_cases (user_id) VALUES ('00000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'a second open case for the same student was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_cases (user_id, stay_from, stay_to)
    VALUES ('00000000-0000-0000-0000-000000000007', '2027-05-01', '2027-04-01');
    RAISE EXCEPTION 'a stay ending before it starts was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_approval_requests (case_id) VALUES ('c0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'a second undecided approval request was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.visa_country_rules (country_iso, country_name, exempt_days) VALUES ('XX', 'Nowhere', 120);
    RAISE EXCEPTION 'exempt days over 90 were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── Legal (global visas.manage) ──────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT pg_temp.expect('legal: cases', (SELECT count(*) FROM public.visa_cases), 3);
SELECT pg_temp.expect('legal: documents', (SELECT count(*) FROM public.visa_case_documents), 2);
SELECT pg_temp.expect('legal: requests', (SELECT count(*) FROM public.visa_approval_requests), 1);
SELECT pg_temp.expect('legal: questions', (SELECT count(*) FROM public.visa_case_questions), 1);
SELECT pg_temp.expect('legal: events', (SELECT count(*) FROM public.visa_case_events), 1);
INSERT INTO public.visa_cases (id, user_id) VALUES
  ('c0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000007');
UPDATE public.visa_country_rules SET processing_weeks = 6 WHERE country_iso = 'US';
DO $$
BEGIN
  DELETE FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000009';
  RAISE EXCEPTION 'legal deleted a case';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  DELETE FROM public.visa_case_documents;
  RAISE EXCEPTION 'legal deleted documents';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
-- Global legal may change who a case is for (a case opened on the wrong
-- person). The empty test case is then removed as the owner.
UPDATE public.visa_cases SET user_id = '00000000-0000-0000-0000-000000000003'
 WHERE id = 'c0000000-0000-0000-0000-000000000009';
DO $$
BEGIN
  INSERT INTO public.visa_case_events (case_id, kind) VALUES ('c0000000-0000-0000-0000-000000000001', 'tampered');
  RAISE EXCEPTION 'legal wrote to the event log directly';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

RESET ROLE;
DELETE FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000009';  -- no history yet
SET ROLE authenticated;
-- An admin counts as legal.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'true', '', '');
SET ROLE authenticated;
SELECT pg_temp.expect('admin: cases', (SELECT count(*) FROM public.visa_cases), 3);
RESET ROLE;

-- ── Legal scoped to school A ─────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false',
                       'visas.manage', 'visas.manage:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.expect('scoped legal A: cases (1 and 3)', (SELECT count(*) FROM public.visa_cases), 2);
SELECT pg_temp.expect('scoped legal A: requests', (SELECT count(*) FROM public.visa_approval_requests), 1);
WITH u AS (UPDATE public.visa_cases SET lodged_where = 'x'
            WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1)
SELECT pg_temp.expect('scoped legal A: updates case 1', (SELECT count(*) FROM u), 1);
WITH u AS (UPDATE public.visa_cases SET lodged_where = 'x'
            WHERE id = 'c0000000-0000-0000-0000-000000000002' RETURNING 1)
SELECT pg_temp.expect('scoped legal A: not case 2', (SELECT count(*) FROM u), 0);
-- Scoped legal can't hand a case they manage to another student, or swap
-- its school for one they don't hold.
DO $$
BEGIN
  UPDATE public.visa_cases SET user_id = '00000000-0000-0000-0000-000000000007'
   WHERE id = 'c0000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'scoped legal changed who a case is for';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  UPDATE public.visa_case_schools SET program_id = 'b0000000-0000-0000-0000-00000000000b'
   WHERE case_id = 'c0000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'scoped legal changed a case''s school';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
-- Scoped legal can add a document row to their own case only at its own path.
DO $$
BEGIN
  INSERT INTO public.visa_case_documents (case_id, document_type_id, storage_path, status)
  SELECT 'c0000000-0000-0000-0000-000000000001', id,
         'c0000000-0000-0000-0000-000000000002/d0000000-0000-0000-0000-000000000002.pdf', 'uploaded'
    FROM public.visa_document_types WHERE code = 'passport_photos';
  RAISE EXCEPTION 'scoped legal pointed a document at case 2''s file';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.visa_country_rules (country_iso, country_name) VALUES ('GB', 'United Kingdom');
  RAISE EXCEPTION 'scoped legal edited country rules';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
UPDATE public.visa_cases SET lodged_where = NULL;

-- has_permission() alone (module visibility) opens no rows.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', 'visas.manage,visas.follow_up', '');
SET ROLE authenticated;
SELECT pg_temp.expect('module visibility only: cases', (SELECT count(*) FROM public.visa_cases), 0);
RESET ROLE;

-- ── Leader of school A (scoped) ──────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.expect('leader A: cases (1 and 3)', (SELECT count(*) FROM public.visa_cases), 2);
SELECT pg_temp.expect('leader A: not case 2',
  (SELECT count(*) FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000002'), 0);
SELECT pg_temp.expect('leader A: all schools of its cases', (SELECT count(*) FROM public.visa_case_schools), 3);
SELECT pg_temp.expect('leader A: documents (case 1 only)', (SELECT count(*) FROM public.visa_case_documents), 1);
SELECT pg_temp.expect('leader A: requests', (SELECT count(*) FROM public.visa_approval_requests), 1);
SELECT pg_temp.expect('leader A: questions', (SELECT count(*) FROM public.visa_case_questions), 1);
SELECT pg_temp.expect('leader A: events', (SELECT count(*) FROM public.visa_case_events), 1);
SELECT pg_temp.expect('leader A: reads document types', (SELECT count(*) FROM public.visa_document_types), 14);
-- Writes are legal-only in step 1: updates touch nothing, inserts fail.
WITH u AS (UPDATE public.visa_cases SET status = 'approved' RETURNING 1)
SELECT pg_temp.expect('leader A: cannot change a case', (SELECT count(*) FROM u), 0);
WITH u AS (UPDATE public.visa_case_documents SET status = 'approved' RETURNING 1)
SELECT pg_temp.expect('leader A: cannot review in step 1', (SELECT count(*) FROM u), 0);
DO $$
BEGIN
  INSERT INTO public.visa_cases (user_id) VALUES ('00000000-0000-0000-0000-000000000007');
  RAISE EXCEPTION 'leader A created a case';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.visa_country_rules (country_iso, country_name) VALUES ('GB', 'United Kingdom');
  RAISE EXCEPTION 'leader A edited country rules';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- ── Leader of school B (scoped) ──────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000003', 'false',
                       'visas.follow_up', 'visas.follow_up:b0000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT pg_temp.expect('leader B: cases (2 and 3)', (SELECT count(*) FROM public.visa_cases), 2);
SELECT pg_temp.expect('leader B: documents (case 2 only)', (SELECT count(*) FROM public.visa_case_documents), 1);
SELECT pg_temp.expect('leader B: no requests on case 1', (SELECT count(*) FROM public.visa_approval_requests), 0);
SELECT pg_temp.expect('leader B: no questions on case 1', (SELECT count(*) FROM public.visa_case_questions), 0);
RESET ROLE;

-- ── Student on school A (own case 1) ─────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.expect('student: own case only', (SELECT count(*) FROM public.visa_cases), 1);
SELECT pg_temp.expect('student: own schools', (SELECT count(*) FROM public.visa_case_schools), 1);
SELECT pg_temp.expect('student: own documents', (SELECT count(*) FROM public.visa_case_documents), 1);
SELECT pg_temp.expect('student: no requests', (SELECT count(*) FROM public.visa_approval_requests), 0);
SELECT pg_temp.expect('student: no questions', (SELECT count(*) FROM public.visa_case_questions), 0);
SELECT pg_temp.expect('student: no events', (SELECT count(*) FROM public.visa_case_events), 0);
SELECT pg_temp.expect('student: reads country rules', (SELECT count(*) FROM public.visa_country_rules), 1);
WITH u AS (UPDATE public.visa_cases SET status = 'granted' RETURNING 1)
SELECT pg_temp.expect('student: cannot change own case', (SELECT count(*) FROM u), 0);
RESET ROLE;

-- ── Outsider ─────────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.expect('outsider: cases', (SELECT count(*) FROM public.visa_cases), 0);
SELECT pg_temp.expect('outsider: schools', (SELECT count(*) FROM public.visa_case_schools), 0);
SELECT pg_temp.expect('outsider: documents', (SELECT count(*) FROM public.visa_case_documents), 0);
RESET ROLE;

-- ── Unscoped follow-up grant sees every school (documented) ──
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', 'visas.follow_up', 'visas.follow_up:*');
SET ROLE authenticated;
SELECT pg_temp.expect('unscoped leader: all cases', (SELECT count(*) FROM public.visa_cases), 3);
RESET ROLE;

-- ── Anon: no table privileges at all ─────────────────────
SELECT pg_temp.as_user('', 'false', '', '');
SET ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.visa_cases;
  RAISE EXCEPTION 'anon read visa_cases';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.visa_document_types;
  RAISE EXCEPTION 'anon read visa_document_types';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- ── Service role: event log is append-only ───────────────
SET ROLE service_role;
INSERT INTO public.visa_case_events (case_id, kind) VALUES ('c0000000-0000-0000-0000-000000000001', 'document_downloaded');
DO $$
BEGIN
  UPDATE public.visa_case_events SET kind = 'edited';
  RAISE EXCEPTION 'service role edited the event log';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  DELETE FROM public.visa_case_events;
  RAISE EXCEPTION 'service role deleted from the event log';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

\echo 'visa_rls: all checks passed'
