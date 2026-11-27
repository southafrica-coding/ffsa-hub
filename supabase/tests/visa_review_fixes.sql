-- Disposable check for migration 501 (Jack's review follow-ups). Not a
-- migration. Same stubs as visa_embassies.sql, then: passport numbers are
-- caught however they're typed (spaces of any kind, hyphens, dots,
-- zero-width characters, any length) in notes, letters and templates; and
-- every open of one of FFSA's documents is recorded, legal's too.
--
--   dropdb --if-exists visa_review_fixes && createdb visa_review_fixes
--   psql -v ON_ERROR_STOP=1 -d visa_review_fixes -f supabase/tests/visa_review_fixes.sql



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
\ir ../migrations/501_visa_review_fixes.sql
\ir ../migrations/501_visa_review_fixes.sql

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
  ('00000000-0000-0000-0000-000000000005', 'Other', 'Student', 'Male', 'Testland', 'AB12'),
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


CREATE OR REPLACE FUNCTION pg_temp.as_student2() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000005', 'false', '', '');
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

-- ── A template and a letter with each student to check ──
INSERT INTO public.visa_letter_templates (id, kind, program_id, version, title, body, status, published_at)
VALUES ('70000000-0000-0000-0000-000000000001', 'invitation', 'a0000000-0000-0000-0000-00000000000a', 1, 'T',
        'Dear {{addressee}}, {{full_name}} ({{passport_number}}). Repatriation.', 'current', now());
UPDATE public.visa_cases SET status = 'approved' WHERE id = 'c0000000-0000-0000-0000-000000000002';
INSERT INTO public.visa_letters (id, case_id, template_id, kind, program_id, letter_date, title, body)
VALUES ('71000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
        'invitation', 'a0000000-0000-0000-0000-00000000000a', '2026-11-26', 'T', 'Test Student ({{passport_number}}).'),
       ('71000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001',
        'invitation', 'a0000000-0000-0000-0000-00000000000a', '2026-11-26', 'T', 'Other Student ({{passport_number}}).');

-- ── The student's note: however the number is typed ──────
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.refused('hyphens and dots',
  $q$SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000001', false, 'It should be xt-123.45.67')$q$, 'P0001');
SELECT pg_temp.refused('a non-breaking space',
  $q$SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000001', false, 'It should be XT' || chr(160) || '1234567')$q$, 'P0001');
SELECT pg_temp.refused('a zero-width space',
  $q$SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000001', false, 'It should be XT' || chr(8203) || '1234567')$q$, 'P0001');
SELECT pg_temp.refused('a tab and new line',
  $q$SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000001', false, 'XT12' || chr(9) || '34' || chr(10) || '567')$q$, 'P0001');
SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000001', false, 'My surname is spelt wrong');
RESET ROLE;
SELECT pg_temp.expect_text('an ordinary note is kept',
  (SELECT student_note FROM public.visa_letters WHERE id = '71000000-0000-0000-0000-000000000001'), 'My surname is spelt wrong');

-- A short number counts too.
SELECT pg_temp.as_student2();
SET ROLE authenticated;
SELECT pg_temp.refused('a four-character number',
  $q$SELECT public.visa_confirm_letter('71000000-0000-0000-0000-000000000002', false, 'Number is a-b 1 2')$q$, 'P0001');
RESET ROLE;

-- ── Legal's notes and letters ────────────────────────────
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('withdraw note with dots',
  $q$SELECT public.visa_withdraw_letter('71000000-0000-0000-0000-000000000001', 'Wrong: x.t.1.2.3.4.5.6.7')$q$, 'P0001');
SELECT pg_temp.refused('a letter with the number hyphenated',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
       '2026-11-26', 'Test Student XT-123-4567. Repatriation.')$q$, 'P0001');

-- ── Templates: nobody's passport number ──────────────────
SELECT pg_temp.refused('a number in the body',
  $q$SELECT public.visa_save_letter_template('accommodation', NULL, 'T', 'Test Student, passport xt 1234567, stays here.')$q$, 'P0001');
SELECT pg_temp.refused('a number in the title',
  $q$SELECT public.visa_save_letter_template('accommodation', NULL, 'For XT1234567', 'Body')$q$, 'P0001');
SELECT pg_temp.refused('a number in the change note',
  $q$SELECT public.visa_save_letter_template('accommodation', NULL, 'T', 'Body', 'Copied from XT1234567''s letter')$q$, 'P0001');
-- A short number on file doesn't block ordinary text ("AB12" vs "Ab 12 May").
SELECT public.visa_save_letter_template('accommodation', NULL, 'T', 'Arrives Ab 12 May; {{passport_number}}.');
RESET ROLE;
SELECT pg_temp.expect('the clean template was saved',
  (SELECT count(*) FROM public.visa_letter_templates WHERE kind = 'accommodation'), 1);

-- ── FFSA's documents: every open recorded ────────────────
UPDATE public.visa_standing_documents
   SET storage_path = 'standing/' || id || '.pdf', mime_type = 'application/pdf', for_students = true
 WHERE label = 'NPO certificate';
CREATE TEMP TABLE npo AS SELECT id FROM public.visa_standing_documents WHERE label = 'NPO certificate';
GRANT SELECT ON npo TO authenticated;

SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT public.visa_standing_document_path((SELECT id FROM npo));
SELECT pg_temp.refused('legal writes the record by hand',
  $q$INSERT INTO public.visa_standing_document_events (document_id, kind) VALUES ((SELECT id FROM npo), 'opened')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT public.visa_standing_document_path((SELECT id FROM npo), 'c0000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect('a student reads no records', (SELECT count(*) FROM public.visa_standing_document_events), 0);
RESET ROLE;
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.expect('a leader reads no records', (SELECT count(*) FROM public.visa_standing_document_events), 0);
RESET ROLE;
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.expect('legal sees both opens', (SELECT count(*) FROM public.visa_standing_document_events), 2);
SELECT pg_temp.expect('legal''s open has no case',
  (SELECT count(*) FROM public.visa_standing_document_events
    WHERE case_id IS NULL AND actor_id = '00000000-0000-0000-0000-000000000001'), 1);
RESET ROLE;
SELECT pg_temp.expect('the student''s is on the case too',
  (SELECT count(*) FROM public.visa_case_events WHERE kind = 'standing_document_downloaded'), 1);
SET ROLE service_role;
SELECT pg_temp.refused('service_role deletes the record',
  $q$DELETE FROM public.visa_standing_document_events$q$, '42501');
RESET ROLE;

\echo 'visa_review_fixes: all checks passed'
