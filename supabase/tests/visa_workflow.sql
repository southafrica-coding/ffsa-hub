-- Disposable check for migration 363 (visa workflow functions). Not a
-- migration. Same stubs as visa_rls.sql, then walks one case from upload
-- to arrival and tries every move the wrong person shouldn't make.
--
--   dropdb --if-exists visa_workflow && createdb visa_workflow
--   psql -v ON_ERROR_STOP=1 -d visa_workflow -f supabase/tests/visa_workflow.sql
--
-- Users are switched as in visa_rls.sql (request.jwt.claim.sub, test.admin,
-- test.perms, test.scoped).



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

\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql
\ir ../migrations/363_visa_workflow.sql
-- Re-running must not fail or duplicate anything.
\ir ../migrations/360_visa_schema.sql
\ir ../migrations/361_visa_rls.sql
\ir ../migrations/362_visa_seed.sql
\ir ../migrations/363_visa_workflow.sql

GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;

-- ── Seed: school A, legal 1, leader of A 2, student 4, outsider 7 ──
INSERT INTO public.programs (id, name) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'School A'),
  ('b0000000-0000-0000-0000-00000000000b', 'School B');
INSERT INTO public.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000007');
-- 89-day stay: the short list (10 types: 3 conditional, 2 offline, 5 uploads).
INSERT INTO public.visa_cases (id, user_id, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', '2027-01-10', '2027-04-08');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a');
-- Case 2: leader 2's own visa, on the school they lead.
INSERT INTO public.visa_cases (id, user_id, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '2027-01-10', '2027-04-08');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a');
-- Case 3: student 5, over 90 days on school A (police clearance needed).
INSERT INTO public.visa_cases (id, user_id, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', '2027-01-10', '2027-07-30');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a');

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

CREATE OR REPLACE FUNCTION pg_temp.doc_type(p_code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.visa_document_types WHERE code = p_code;
$$;
CREATE OR REPLACE FUNCTION pg_temp.path(p_doc text) RETURNS text LANGUAGE sql AS $$
  SELECT 'c0000000-0000-0000-0000-000000000001/' || p_doc || '.pdf';
$$;

-- ── Outsider and anon can't touch the case ───────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.refused('outsider uploads',
  $q$SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000099', 'c0000000-0000-0000-0000-000000000001',
     pg_temp.doc_type('passport'), pg_temp.path('d0000000-0000-0000-0000-000000000099'), 'application/pdf', 10)$q$, '42501');
SELECT pg_temp.refused('outsider asks legal',
  $q$SELECT public.visa_ask_legal('c0000000-0000-0000-0000-000000000001', 'hi')$q$, '42501');
SELECT pg_temp.refused('outsider reads the checklist',
  $q$SELECT public.visa_case_missing_documents('c0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('', 'false', '', '');
SET ROLE anon;
SELECT pg_temp.refused('anon uploads',
  $q$SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000099', 'c0000000-0000-0000-0000-000000000001',
     pg_temp.doc_type('passport'), pg_temp.path('d0000000-0000-0000-0000-000000000099'), 'application/pdf', 10)$q$, '42501');
RESET ROLE;

-- ── Leader of school B can't act on a school A case ──────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000003', 'false',
                       'visas.follow_up', 'visas.follow_up:b0000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT pg_temp.refused('leader B requests approval',
  $q$SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;

-- ── A leader can't be staff on their own case ───────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
-- As the student on case 2 they upload like anyone.
SELECT public.visa_add_document('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
  pg_temp.doc_type('passport'),
  'c0000000-0000-0000-0000-000000000002/e0000000-0000-0000-0000-000000000001.pdf', 'application/pdf', 10);
SELECT pg_temp.refused('leader: reviews a document on own case',
  $q$SELECT public.visa_review_document('e0000000-0000-0000-0000-000000000001', true)$q$, '42501');
SELECT pg_temp.refused('leader: requests approval on own case',
  $q$SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000002')$q$, '42501');
SELECT pg_temp.refused('leader: records progress on own case',
  $q$SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000002', 'lodged', '{"lodged_on":"2026-12-01"}')$q$, '42501');
RESET ROLE;
-- Legal for everything, but this is their own case.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT pg_temp.refused('legal: closes own case',
  $q$SELECT public.visa_close_case('c0000000-0000-0000-0000-000000000002', true)$q$, '42501');
RESET ROLE;

-- ── Nobody writes the case tables directly, legal included ──
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT pg_temp.refused('legal: sets a status directly',
  $q$UPDATE public.visa_cases SET status = 'approved' WHERE id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
SELECT pg_temp.refused('legal: inserts a decided request directly',
  $q$INSERT INTO public.visa_approval_requests (case_id, decision, decided_at) VALUES ('c0000000-0000-0000-0000-000000000001', 'approved', now())$q$, '42501');
SELECT pg_temp.refused('legal: approves a document directly',
  $q$UPDATE public.visa_case_documents SET status = 'approved'$q$, '42501');
SELECT pg_temp.refused('legal: moves a school directly',
  $q$UPDATE public.visa_case_schools SET program_id = 'b0000000-0000-0000-0000-00000000000b'$q$, '42501');
SELECT pg_temp.refused('legal: opens a case directly',
  $q$INSERT INTO public.visa_cases (user_id) VALUES ('00000000-0000-0000-0000-000000000007')$q$, '42501');
RESET ROLE;

-- ── Student uploads ──────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.expect('student: 7 things missing at the start (3 conditional types never block)',
  (SELECT count(*) FROM public.visa_case_missing_documents('c0000000-0000-0000-0000-000000000001')), 7);
SELECT pg_temp.refused('student: path for another document',
  $q$SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
     pg_temp.doc_type('passport'), pg_temp.path('d0000000-0000-0000-0000-000000000002'), 'application/pdf', 10)$q$, 'P0001');
SELECT pg_temp.refused('student: uploads an offline step',
  $q$SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
     pg_temp.doc_type('form_dha84'), pg_temp.path('d0000000-0000-0000-0000-000000000001'), 'application/pdf', 10)$q$, 'P0001');

-- Every upload type on the short list, plus the two offline steps.
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT id, code, is_offline FROM public.visa_document_types
            WHERE needed_up_to_90 AND NOT is_conditional ORDER BY sort_order LOOP
    n := n + 1;
    IF t.is_offline THEN
      PERFORM public.visa_tick_offline('c0000000-0000-0000-0000-000000000001', t.id);
    ELSE
      PERFORM public.visa_add_document(
        ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
        'c0000000-0000-0000-0000-000000000001', t.id,
        'c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-' || lpad(n::text, 12, '0') || '.pdf',
        'application/pdf', 1000, NULL);
    END IF;
  END LOOP;
END $$;
SELECT pg_temp.refused('student: ticks the same step twice',
  $q$SELECT public.visa_tick_offline('c0000000-0000-0000-0000-000000000001', pg_temp.doc_type('form_dha84'))$q$, 'P0001');
SELECT pg_temp.refused('student: requests approval',
  $q$SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001')$q$, '42501');
SELECT pg_temp.refused('student: reviews own document',
  $q$SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000001', true)$q$, '42501');
SELECT pg_temp.refused('student: updates the case directly',
  $q$UPDATE public.visa_cases SET status = 'approved'$q$, '42501');
RESET ROLE;
SELECT pg_temp.expect_text('waiting on the leader once all is in',
  (SELECT waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'), 'school_leader');
SELECT pg_temp.expect('events: uploads and ticks logged as the student',
  (SELECT count(*) FROM public.visa_case_events WHERE actor_id = '00000000-0000-0000-0000-000000000004'), 7);

-- ── Leader of A reviews ──────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: request before reviewing',
  $q$SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001')$q$, 'P0001');
SELECT pg_temp.refused('leader: flag without a note',
  $q$SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000001', false, '  ')$q$, 'P0001');
SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000001', false, 'Photo page is cut off');
SELECT pg_temp.refused('leader: reviews twice',
  $q$SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000001', true)$q$, 'P0001');
RESET ROLE;
-- A leader flags; they never reject (legal's call).
SELECT pg_temp.expect_text('a leader''s "no" is a flag',
  (SELECT status FROM public.visa_case_documents WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'flagged');
SELECT pg_temp.expect_text('waiting on the student after a flag',
  (SELECT waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'), 'student');

-- Student re-uploads the passport.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
SET ROLE authenticated;
SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000101', 'c0000000-0000-0000-0000-000000000001',
  pg_temp.doc_type('passport'), pg_temp.path('d0000000-0000-0000-0000-000000000101'), 'application/pdf', 10);
SELECT pg_temp.expect('student sees the redo note',
  (SELECT count(*) FROM public.visa_case_documents WHERE review_note = 'Photo page is cut off'), 1);
RESET ROLE;

SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
DO $$
DECLARE d record;
BEGIN
  FOR d IN SELECT id FROM public.visa_case_documents
            WHERE case_id = 'c0000000-0000-0000-0000-000000000001' AND status = 'uploaded' LOOP
    PERFORM public.visa_review_document(d.id, true);
  END LOOP;
END $$;
SELECT pg_temp.expect_text('a leader''s "yes" is checked, not approved',
  (SELECT status FROM public.visa_case_documents WHERE id = 'd0000000-0000-0000-0000-000000000101'), 'checked');
SELECT pg_temp.expect('leader: nothing missing',
  (SELECT count(*) FROM public.visa_case_missing_documents('c0000000-0000-0000-0000-000000000001')), 0);
SELECT public.visa_ask_legal('c0000000-0000-0000-0000-000000000001', 'Refused by the UK in 2024. Does that matter?');
SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001', 'All in');
SELECT pg_temp.refused('leader: second request',
  $q$SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001')$q$, 'P0001');
SELECT pg_temp.refused('leader: approves own request',
  $q$SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests LIMIT 1), true)$q$, '42501');
SELECT pg_temp.refused('leader: answers the question',
  $q$SELECT public.visa_answer_question((SELECT id FROM public.visa_case_questions LIMIT 1), 'no')$q$, '42501');
SELECT pg_temp.refused('leader: closes the case',
  $q$SELECT public.visa_close_case('c0000000-0000-0000-0000-000000000001', true)$q$, '42501');
RESET ROLE;
SELECT pg_temp.expect_text('status after the request',
  (SELECT status || '/' || waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'awaiting_legal/legal');

-- ── Legal sends back, then approves ──────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT public.visa_answer_question((SELECT id FROM public.visa_case_questions LIMIT 1), 'Mention it on the form; it is fine.');
-- Legal judges documents, also while the case waits for legal.
SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000101', true);
SELECT pg_temp.expect_text('legal approves a checked document',
  (SELECT status FROM public.visa_case_documents WHERE id = 'd0000000-0000-0000-0000-000000000101'), 'approved');
SELECT pg_temp.refused('legal: reviews an approved document again',
  $q$SELECT public.visa_review_document('d0000000-0000-0000-0000-000000000101', false, 'x')$q$, 'P0001');
SELECT pg_temp.refused('legal: send back without a note',
  $q$SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests WHERE decision IS NULL), false)$q$, 'P0001');
SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests WHERE decision IS NULL), false, 'Add the bank letter');
RESET ROLE;
SELECT pg_temp.expect_text('status after a send-back',
  (SELECT status || '/' || waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'sent_back/school_leader');

-- This time legal sends the request itself, so legal can't decide it.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT public.visa_request_approval('c0000000-0000-0000-0000-000000000001', 'Bank letter added');
SELECT pg_temp.refused('legal: decides own request',
  $q$SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests WHERE decision IS NULL), true)$q$, 'P0001');
RESET ROLE;

SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: lodge before approval',
  $q$SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'lodged', '{"lodged_on":"2026-12-01"}')$q$, 'P0001');
RESET ROLE;

-- A backup approver (visas.manage for school A) decides it.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', 'visas.manage', 'visas.manage:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests WHERE decision IS NULL), true);
SELECT pg_temp.refused('legal: decides twice',
  $q$SELECT public.visa_decide((SELECT id FROM public.visa_approval_requests ORDER BY requested_at DESC LIMIT 1), true)$q$, 'P0001');
RESET ROLE;
SELECT pg_temp.expect_text('status after approval',
  (SELECT status FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'), 'approved');

-- Approved: documents are frozen.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.refused('student: upload after approval',
  $q$SELECT public.visa_add_document('d0000000-0000-0000-0000-000000000102', 'c0000000-0000-0000-0000-000000000001',
     pg_temp.doc_type('passport'), pg_temp.path('d0000000-0000-0000-0000-000000000102'), 'application/pdf', 10)$q$, 'P0001');
SELECT pg_temp.refused('student: records progress',
  $q$SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'lodged', '{"lodged_on":"2026-12-01"}')$q$, '42501');
RESET ROLE;

-- ── Leader records lodged → granted → arrived ───────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: lodged without a day',
  $q$SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'lodged', '{}')$q$, 'P0001');
SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'lodged',
  '{"lodged_on":"2026-12-01","lodged_where":"Embassy","embassy_reference":"REF-1","passport_number":"X1"}');
SELECT pg_temp.refused('leader: arrived before granted',
  $q$SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'arrived', '{"arrived_on":"2027-01-10","entry_stamp_ok":true}')$q$, 'P0001');
SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'granted', '{"visa_valid_to":"2027-04-08"}');
SELECT public.visa_record_progress('c0000000-0000-0000-0000-000000000001', 'arrived', '{"arrived_on":"2027-01-10","entry_stamp_ok":false}');
RESET ROLE;
SELECT pg_temp.expect_text('wrong entry stamp goes to legal',
  (SELECT status || '/' || waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'arrived/legal');
SELECT pg_temp.expect('no event detail carries a passport number',
  (SELECT count(*) FROM public.visa_case_events WHERE detail::text ILIKE '%passport_number%' OR detail::text LIKE '%X1%'), 0);

-- ── Legal closes; closed cases accept nothing ───────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT public.visa_close_case('c0000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.refused('legal: closes twice',
  $q$SELECT public.visa_close_case('c0000000-0000-0000-0000-000000000001', false)$q$, 'P0001');
RESET ROLE;

-- ── Restricted documents: police clearance (case 3) ─────
CREATE OR REPLACE FUNCTION pg_temp.path3(p_doc text) RETURNS text LANGUAGE sql AS $$
  SELECT 'c0000000-0000-0000-0000-000000000003/' || p_doc || '.pdf';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.path3(text) TO authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: uploads a police clearance for the student',
  $q$SELECT public.visa_add_document('f0000000-0000-0000-0000-000000000099', 'c0000000-0000-0000-0000-000000000003',
     pg_temp.doc_type('police_clearance'), pg_temp.path3('f0000000-0000-0000-0000-000000000099'), 'application/pdf', 10)$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000005', 'false', '', '');
SET ROLE authenticated;
SELECT public.visa_add_document('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
  pg_temp.doc_type('police_clearance'), pg_temp.path3('f0000000-0000-0000-0000-000000000001'), 'application/pdf', 10);
SELECT public.visa_add_document('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
  pg_temp.doc_type('passport'), pg_temp.path3('f0000000-0000-0000-0000-000000000002'), 'application/pdf', 10);
RESET ROLE;
SELECT pg_temp.expect('an uploaded police clearance counts as in (legal judges it)',
  (SELECT count(*) FROM public.visa_missing_documents('c0000000-0000-0000-0000-000000000003') m WHERE m = 'police_clearance'), 0);
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: reviews a police clearance',
  $q$SELECT public.visa_review_document('f0000000-0000-0000-0000-000000000001', true)$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', 'visas.manage', 'visas.manage:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('legal scoped to the school: reviews a police clearance',
  $q$SELECT public.visa_review_document('f0000000-0000-0000-0000-000000000001', true)$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000001', 'false', 'visas.manage', 'visas.manage:*');
SET ROLE authenticated;
SELECT public.visa_review_document('f0000000-0000-0000-0000-000000000001', false, 'Older than 6 months');
RESET ROLE;
SELECT pg_temp.expect_text('global legal asks for a new police clearance',
  (SELECT status FROM public.visa_case_documents WHERE id = 'f0000000-0000-0000-0000-000000000001'), 'needs_redo');
SELECT pg_temp.expect('a police clearance needing a redo blocks the request',
  (SELECT count(*) FROM public.visa_missing_documents('c0000000-0000-0000-0000-000000000003') m WHERE m = 'police_clearance'), 1);
-- Once the stay has ended, a leader can't review the case's documents.
UPDATE public.visa_cases SET stay_from = '2025-10-01', stay_to = '2026-01-01'
 WHERE id = 'c0000000-0000-0000-0000-000000000003';
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000002', 'false',
                       'visas.follow_up', 'visas.follow_up:a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.refused('leader: reviews after the stay ended',
  $q$SELECT public.visa_review_document('f0000000-0000-0000-0000-000000000002', true)$q$, '42501');
RESET ROLE;

-- ── Internal helpers aren't callable by users ────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000004', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.refused('student: calls the logger',
  $q$SELECT public.visa_log('c0000000-0000-0000-0000-000000000001', 'forged', '{}')$q$, '42501');
SELECT pg_temp.refused('student: refreshes waiting_on',
  $q$SELECT public.visa_refresh_waiting_on('c0000000-0000-0000-0000-000000000001')$q$, '42501');
RESET ROLE;

\echo 'visa_workflow: all checks passed'
