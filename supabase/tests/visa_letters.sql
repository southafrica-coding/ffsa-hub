-- Disposable check for migration 366 (visa letters). Not a migration. Same
-- stubs as visa_workflow.sql, then: templates are versioned and only global
-- legal edits them; a letter is issued on an approved case, checked by the
-- student, signed by legal with a scan; passport numbers never land in the
-- letter tables; every wrong-person move is refused.
--
--   dropdb --if-exists visa_letters && createdb visa_letters
--   psql -v ON_ERROR_STOP=1 -d visa_letters -f supabase/tests/visa_letters.sql



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
\ir ../migrations/366_visa_letters.sql

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
-- The current template of a kind for school A (or for any school).
CREATE OR REPLACE FUNCTION pg_temp.current_template(p_kind text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.visa_letter_templates
   WHERE kind = p_kind AND status = 'current'
     AND (program_id IS NULL OR program_id = 'a0000000-0000-0000-0000-00000000000a');
$$;
CREATE OR REPLACE FUNCTION pg_temp.live_letter() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.visa_letters
   WHERE case_id = 'c0000000-0000-0000-0000-000000000001' AND kind = 'invitation'
     AND status NOT IN ('replaced', 'withdrawn');
$$;
CREATE OR REPLACE FUNCTION pg_temp.case1_waiting() RETURNS text LANGUAGE sql AS $$
  SELECT waiting_on FROM public.visa_cases WHERE id = 'c0000000-0000-0000-0000-000000000001';
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

-- ── Templates: only global legal writes them ────────────
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.refused('leader saves a template',
  $q$SELECT public.visa_save_letter_template('invitation', 'a0000000-0000-0000-0000-00000000000a', 'T', 'Body')$q$, '42501');
SELECT pg_temp.expect('leader reads no templates', (SELECT count(*) FROM public.visa_letter_templates), 0);
RESET ROLE;
SELECT pg_temp.as_legal_b();
SET ROLE authenticated;
SELECT pg_temp.refused('legal scoped to B saves a template',
  $q$SELECT public.visa_save_letter_template('accommodation', NULL, 'T', 'Body')$q$, '42501');
RESET ROLE;

SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('an invitation needs a school',
  $q$SELECT public.visa_save_letter_template('invitation', NULL, 'T', 'Body')$q$, 'P0001');
SELECT pg_temp.refused('unknown letter',
  $q$SELECT public.visa_save_letter_template('reference', NULL, 'T', 'Body')$q$, 'P0001');
SELECT public.visa_save_letter_template('invitation', 'a0000000-0000-0000-0000-00000000000a',
  'Invitation for School A', 'Dear {{addressee}}, {{full_name}} ({{passport_number}}) is coming.');
-- A second save updates the same draft.
SELECT public.visa_save_letter_template('invitation', 'a0000000-0000-0000-0000-00000000000a',
  'Invitation for School A', 'Dear {{addressee}}, {{full_name}} ({{passport_number}}) is coming to {{school_name}}.');
SELECT pg_temp.expect('one draft after two saves', (SELECT count(*) FROM public.visa_letter_templates), 1);
SELECT pg_temp.refused('an invitation without the repatriation undertaking',
  $q$SELECT public.visa_publish_letter_template((SELECT id FROM public.visa_letter_templates))$q$, 'P0001');
SELECT public.visa_save_letter_template('invitation', 'a0000000-0000-0000-0000-00000000000a',
  'Invitation for School A',
  'Dear {{addressee}}, {{full_name}} ({{passport_number}}) is coming to {{school_name}}. FFSA undertakes repatriation.');
SELECT public.visa_publish_letter_template((SELECT id FROM public.visa_letter_templates WHERE status = 'draft'));
SELECT pg_temp.expect('v1 is current', (SELECT version FROM public.visa_letter_templates WHERE status = 'current'), 1);
-- Version 2 retires version 1.
SELECT public.visa_save_letter_template('invitation', 'a0000000-0000-0000-0000-00000000000a',
  'Invitation for School A', 'v2 {{full_name}} {{passport_number}}, repatriation.', 'Shorter');
SELECT pg_temp.expect('v1 still current while v2 is a draft',
  (SELECT version FROM public.visa_letter_templates WHERE status = 'current'), 1);
SELECT public.visa_publish_letter_template((SELECT id FROM public.visa_letter_templates WHERE status = 'draft'));
SELECT pg_temp.expect('v2 is current', (SELECT version FROM public.visa_letter_templates WHERE status = 'current'), 2);
SELECT pg_temp.expect('v1 is retired', (SELECT count(*) FROM public.visa_letter_templates WHERE status = 'retired'), 1);
-- Drafts can be thrown away; published versions can't.
SELECT public.visa_save_letter_template('accommodation', NULL, 'Accommodation', 'Throwaway');
SELECT public.visa_discard_letter_template_draft((SELECT id FROM public.visa_letter_templates WHERE kind = 'accommodation'));
SELECT pg_temp.refused('discard a published version',
  $q$SELECT public.visa_discard_letter_template_draft(pg_temp.current_template('invitation'))$q$, 'P0001');
SELECT pg_temp.refused('legal edits a template directly',
  $q$UPDATE public.visa_letter_templates SET body = 'x'$q$, '42501');
-- A template for school B, which case 1 doesn't cover.
SELECT public.visa_save_letter_template('invitation', 'b0000000-0000-0000-0000-00000000000b',
  'Invitation for School B', 'B {{full_name}}, repatriation.');
SELECT public.visa_publish_letter_template((SELECT id FROM public.visa_letter_templates WHERE status = 'draft'));
RESET ROLE;

-- Even the owner can't rewrite a published version.
SELECT pg_temp.refused('rewrite a published template',
  $q$UPDATE public.visa_letter_templates SET body = 'changed' WHERE status = 'current'$q$, '42501');

-- Legal scoped to B reads templates (to issue letters for their school).
SELECT pg_temp.as_legal_b();
SET ROLE authenticated;
SELECT pg_temp.expect('scoped legal reads templates', (SELECT count(*) FROM public.visa_letter_templates), 3);
RESET ROLE;

-- ── Issuing ──────────────────────────────────────────────
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.refused('leader issues a letter',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letters LIMIT 0), '2026-11-24', 'x')$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_legal_b();
SET ROLE authenticated;
SELECT pg_temp.refused('legal scoped to B issues on a school A case',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     pg_temp.current_template('invitation'), '2026-11-24', 'x')$q$, '42501');
RESET ROLE;

SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('issue before approval',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000002',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'Dear X, Other Student ({{passport_number}}), repatriation.')$q$, 'P0001');
SELECT pg_temp.refused('issue from a school the case does not cover',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'b0000000-0000-0000-0000-00000000000b'),
     '2026-11-24', 'B Test Student, repatriation.')$q$, 'P0001');
SELECT pg_temp.refused('issue from a retired version',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'retired'),
     '2026-11-24', 'Test Student {{passport_number}}, repatriation.')$q$, 'P0001');
SELECT pg_temp.refused('a field left unfilled',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'Dear {{addressee}}, Test Student ({{passport_number}}).')$q$, 'P0001');
SELECT pg_temp.refused('the passport number typed into the text',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'v2 Test Student XT1234567, repatriation.')$q$, 'P0001');
SELECT pg_temp.refused('the passport number in lower case',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'v2 Test Student xt1234567, repatriation.')$q$, 'P0001');
SELECT pg_temp.refused('the passport number with spaces',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'v2 Test Student {{passport_number}}, repatriation.', '{"addressee":"xt 123 4567"}')$q$, 'P0001');
SELECT pg_temp.refused('the passport number in the inputs',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
     (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
     '2026-11-24', 'v2 Test Student {{passport_number}}, repatriation.', '{"addressee":"XT1234567"}')$q$, 'P0001');
SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.visa_letter_templates WHERE status = 'current' AND program_id = 'a0000000-0000-0000-0000-00000000000a'),
  '2026-11-24', 'v2 Test Student {{passport_number}}, repatriation.', '{"addressee":"The Ambassador"}');
SELECT pg_temp.expect_text('issued letter is with the student',
  (SELECT status FROM public.visa_letters WHERE id = pg_temp.live_letter()), 'with_student');
SELECT pg_temp.expect_text('case waits on the student', pg_temp.case1_waiting(), 'student');
SELECT pg_temp.expect('issue is logged',
  (SELECT count(*) FROM public.visa_case_events WHERE kind = 'letter_issued'), 1);
SELECT pg_temp.expect('the passport number is in no letter row',
  (SELECT count(*) FROM public.visa_letters WHERE body LIKE '%XT1234567%' OR inputs::text LIKE '%XT1234567%'), 0);
SELECT pg_temp.refused('legal confirms for the student',
  $q$SELECT public.visa_confirm_letter(pg_temp.live_letter(), true)$q$, '42501');
SELECT pg_temp.refused('legal edits a letter directly',
  $q$UPDATE public.visa_letters SET status = 'signed'$q$, '42501');
SELECT pg_temp.refused('legal inserts a letter directly',
  $q$INSERT INTO public.visa_letters (case_id, template_id, kind, letter_date, title, body)
     VALUES ('c0000000-0000-0000-0000-000000000001', pg_temp.current_template('accommodation'), 'accommodation', '2026-11-24', 'T', 'B')$q$, '42501');
SELECT pg_temp.expect_text('legal reads the passport for the PDF',
  public.visa_letter_passport(pg_temp.live_letter()), 'XT1234567');
SELECT pg_temp.expect_text('legal reads the student''s details',
  (SELECT first_name || ' ' || gender FROM public.visa_letter_student('c0000000-0000-0000-0000-000000000001')), 'Test Female');
RESET ROLE;

-- ── Who reads letters and passports ──────────────────────
SELECT pg_temp.as_leader();
SET ROLE authenticated;
SELECT pg_temp.expect('leader sees the letter row', (SELECT count(*) FROM public.visa_letters), 1);
SELECT pg_temp.refused('leader reads the passport',
  $q$SELECT public.visa_letter_passport(pg_temp.live_letter())$q$, '42501');
SELECT pg_temp.refused('leader reads the student''s details',
  $q$SELECT * FROM public.visa_letter_student('c0000000-0000-0000-0000-000000000001')$q$, '42501');
SELECT pg_temp.refused('leader confirms for the student',
  $q$SELECT public.visa_confirm_letter(pg_temp.live_letter(), true)$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000007', 'false', '', '');
SET ROLE authenticated;
SELECT pg_temp.expect('outsider sees no letters', (SELECT count(*) FROM public.visa_letters), 0);
SELECT pg_temp.expect('outsider sees no templates', (SELECT count(*) FROM public.visa_letter_templates), 0);
RESET ROLE;
SELECT pg_temp.as_user('', 'false', '', '');
SET ROLE anon;
SELECT pg_temp.refused('anon reads letters', $q$SELECT count(*) FROM public.visa_letters$q$, '42501');
RESET ROLE;

-- ── The student checks it ────────────────────────────────
SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT pg_temp.expect('student sees their letter', (SELECT count(*) FROM public.visa_letters), 1);
SELECT pg_temp.expect('student sees no templates', (SELECT count(*) FROM public.visa_letter_templates), 0);
SELECT pg_temp.expect_text('student reads their passport for the PDF',
  public.visa_letter_passport(pg_temp.live_letter()), 'XT1234567');
SELECT pg_temp.refused('student signs their own letter',
  $q$SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
     'c0000000-0000-0000-0000-000000000001/' || pg_temp.live_letter() || '.pdf', 'application/pdf')$q$, '42501');
SELECT pg_temp.refused('something wrong, but not saying what',
  $q$SELECT public.visa_confirm_letter(pg_temp.live_letter(), false, '  ')$q$, 'P0001');
SELECT pg_temp.refused('passport number in the student''s note (leaders read it)',
  $q$SELECT public.visa_confirm_letter(pg_temp.live_letter(), false, 'Passport should be xt1234567')$q$, 'P0001');
SELECT public.visa_confirm_letter(pg_temp.live_letter(), false, 'My surname is spelt wrong');
SELECT pg_temp.expect_text('letter needs a fix', (SELECT status FROM public.visa_letters WHERE id = pg_temp.live_letter()), 'needs_fix');
SELECT pg_temp.expect_text('case waits on legal', pg_temp.case1_waiting(), 'legal');
SELECT pg_temp.refused('confirm a letter that is not with the student',
  $q$SELECT public.visa_confirm_letter(pg_temp.live_letter(), true)$q$, 'P0001');
RESET ROLE;

-- Legal re-issues; the old letter is replaced and linked.
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('sign before the student confirms',
  $q$SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
     'c0000000-0000-0000-0000-000000000001/' || pg_temp.live_letter() || '.pdf', 'application/pdf')$q$, 'P0001');
SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000001',
  pg_temp.current_template('invitation'), '2026-11-25', 'v2 Test Studente {{passport_number}}, repatriation.', '{}');
RESET ROLE;
SELECT pg_temp.expect('one replaced, one live',
  (SELECT count(*) FROM public.visa_letters WHERE status = 'replaced'), 1);
SELECT pg_temp.expect('the new letter points at the old one',
  (SELECT count(*) FROM public.visa_letters WHERE replaces_id IS NOT NULL AND status = 'with_student'), 1);

SELECT pg_temp.as_student();
SET ROLE authenticated;
SELECT public.visa_confirm_letter(pg_temp.live_letter(), true);
SELECT pg_temp.expect_text('confirmed', (SELECT status FROM public.visa_letters WHERE id = pg_temp.live_letter()), 'confirmed');
SELECT pg_temp.expect_text('case waits on legal to sign', pg_temp.case1_waiting(), 'legal');
RESET ROLE;

-- ── Legal signs: the scan ────────────────────────────────
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('a scan at another letter''s path',
  $q$SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
     'c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-000000000001.pdf', 'application/pdf')$q$, 'P0001');
SELECT pg_temp.refused('a scan in another case''s folder',
  $q$SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
     'c0000000-0000-0000-0000-000000000002/' || pg_temp.live_letter() || '.pdf', 'application/pdf')$q$, 'P0001');
SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
  'c0000000-0000-0000-0000-000000000001/' || pg_temp.live_letter() || '.pdf', 'application/pdf');
SELECT pg_temp.expect_text('signed', (SELECT status FROM public.visa_letters WHERE id = pg_temp.live_letter()), 'signed');
SELECT pg_temp.expect_text('case waits on the student to lodge', pg_temp.case1_waiting(), 'student');
SELECT pg_temp.refused('sign twice',
  $q$SELECT public.visa_attach_letter_scan(pg_temp.live_letter(),
     'c0000000-0000-0000-0000-000000000001/' || pg_temp.live_letter() || '.png', 'image/png')$q$, 'P0001');
RESET ROLE;
SELECT pg_temp.refused('repoint a signed scan, even as the owner',
  $q$UPDATE public.visa_letters SET scan_path = NULL WHERE status = 'signed'$q$, '42501');
SELECT pg_temp.refused('rewrite an issued letter, even as the owner',
  $q$UPDATE public.visa_letters SET body = 'changed' WHERE status = 'signed'$q$, '42501');

-- ── Withdraw ─────────────────────────────────────────────
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('withdraw without a reason',
  $q$SELECT public.visa_withdraw_letter(pg_temp.live_letter(), '')$q$, 'P0001');
SELECT pg_temp.refused('passport number in the withdraw note',
  $q$SELECT public.visa_withdraw_letter(pg_temp.live_letter(), 'Wrong number XT1234567')$q$, 'P0001');
SELECT public.visa_withdraw_letter(pg_temp.live_letter(), 'Issued by mistake');
SELECT pg_temp.expect('nothing live after withdrawing',
  (SELECT count(*) FROM public.visa_letters WHERE status NOT IN ('replaced', 'withdrawn')), 0);
SELECT pg_temp.expect('every step logged',
  (SELECT count(*) FROM public.visa_case_events
    WHERE kind IN ('letter_issued', 'letter_problem', 'letter_confirmed', 'letter_signed', 'letter_withdrawn')), 6);
RESET ROLE;

-- ── Own case: legal can't issue for themselves ───────────
INSERT INTO public.visa_cases (id, user_id, status, stay_from, stay_to) VALUES
  ('c0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'approved', '2027-01-10', '2027-04-08');
INSERT INTO public.visa_case_schools (case_id, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a');
SELECT pg_temp.as_legal();
SET ROLE authenticated;
SELECT pg_temp.refused('legal issues on own case',
  $q$SELECT public.visa_issue_letter('c0000000-0000-0000-0000-000000000009',
     pg_temp.current_template('invitation'), '2026-11-24', 'L One {{passport_number}}, repatriation.')$q$, '42501');
RESET ROLE;

\echo 'visa_letters: all checks passed'
