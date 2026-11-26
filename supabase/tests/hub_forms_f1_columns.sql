-- Disposable column/constraint check for migration 390 and the
-- fill_house_church_names ops script. Not a migration.
-- Stubs what 339 and 390 depend on (forms and form_submissions in
-- their 044 shape, staff_ministries, house_churches), applies 339,
-- applies 390 twice, its rollback, and 390 again, then runs the ops
-- script twice.
--
--   dropdb --if-exists hub_forms_f1 && createdb hub_forms_f1
--   psql -v ON_ERROR_STOP=1 -d hub_forms_f1 -f supabase/tests/hub_forms_f1_columns.sql
--
-- Never point this at a shared or hosted database.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Stubs ───────────────────────────────────────────────────

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.organisations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL);
CREATE TABLE public.staff_ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL
);
CREATE TABLE public.house_churches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations (id),
  number int NOT NULL,
  name text,
  meeting_day text,
  location text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
-- 044 shape, minus FKs to tables this test does not need.
CREATE TABLE public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  schema jsonb NOT NULL,
  label_id uuid,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.forms (id) ON DELETE RESTRICT,
  raw_data jsonb NOT NULL,
  dedup_action text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION public.has_org_role(org text, roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.missio_my_house_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;

\ir ../migrations/339_missio_house_feedback.sql

-- ── Data from before 390 ────────────────────────────────────

INSERT INTO public.organisations (id, slug) VALUES
  ('00000000-0000-4000-8000-000000000001', 'missio'),
  ('00000000-0000-4000-8000-000000000002', 'ffsa');
INSERT INTO public.house_churches (id, org_id, number, name, meeting_day, location)
SELECT gen_random_uuid(), '00000000-0000-4000-8000-000000000001', n,
       CASE n WHEN 2 THEN 'Already named' WHEN 3 THEN '   ' END,
       'wednesday', 'Loc ' || n
FROM generate_series(1, 20) n;
-- House 1 of another org: the ops script must leave it alone.
INSERT INTO public.house_churches (org_id, number) VALUES ('00000000-0000-4000-8000-000000000002', 1);
UPDATE public.house_churches SET id = '00000000-0000-4000-8000-0000000000a1'
WHERE number = 1 AND org_id = '00000000-0000-4000-8000-000000000001';

INSERT INTO public.forms (slug, name, schema) VALUES ('old', 'Old form', '{}');
INSERT INTO public.missio_house_feedback (house_church_id, meeting_date, attendance, mood, notes)
VALUES ('00000000-0000-4000-8000-0000000000a1', '2026-11-11', 14, 'good', 'before 390');

-- ── Apply 390 twice, roll back, apply again ─────────────────

\ir ../migrations/390_hub_forms_f1.sql
\ir ../migrations/390_hub_forms_f1.sql
\ir ../rollbacks/390_hub_forms_f1.sql
\ir ../rollbacks/390_hub_forms_f1.sql
\ir ../migrations/390_hub_forms_f1.sql

-- ── Checks ──────────────────────────────────────────────────

CREATE TEMP TABLE checks (n serial PRIMARY KEY, label text NOT NULL, got text, want text, ok boolean NOT NULL);

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO checks (label, got, want, ok) VALUES (label, got, want, got IS NOT DISTINCT FROM want);
  IF got IS DISTINCT FROM want THEN RAISE NOTICE 'FAIL %: got [%] want [%]', label, got, want; END IF;
END $$;

-- Runs stmt; returns 'ok' or the SQLSTATE. Always rolls back what stmt did.
CREATE FUNCTION pg_temp.try(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN 'ok';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

DO $$
DECLARE
  house uuid := '00000000-0000-4000-8000-0000000000a1';
  ins text := 'INSERT INTO public.missio_house_feedback (house_church_id, meeting_date, attendance, mood, %s) VALUES (%L, ''2026-11-18'', 10, ''okay'', %s)';
  form_id uuid;
  sub_id uuid;
BEGIN
  -- Old rows are untouched: new columns null, nothing backfilled.
  PERFORM pg_temp.expect('old feedback row keeps its answers',
    (SELECT attendance || '/' || mood || '/' || notes FROM public.missio_house_feedback WHERE meeting_date = '2026-11-11'),
    '14/good/before 390');
  PERFORM pg_temp.expect('old feedback row has null new columns',
    (SELECT (saved_count IS NULL AND first_time_count IS NULL AND leader_score IS NULL
             AND activities IS NULL AND form_submission_id IS NULL)::text
     FROM public.missio_house_feedback WHERE meeting_date = '2026-11-11'),
    'true');
  PERFORM pg_temp.expect('old form defaults to generic / public / no subject',
    (SELECT kind || '/' || access_mode || '/' || coalesce(subject_type, 'null') || '/' || coalesce(department_id::text, 'null')
     FROM public.forms WHERE slug = 'old'),
    'generic/public/null/null');

  -- Ranges.
  PERFORM pg_temp.expect('saved 6 (more than 5) ok', pg_temp.try(format(ins, 'saved_count', house, '6')), 'ok');
  PERFORM pg_temp.expect('saved 7 rejected', pg_temp.try(format(ins, 'saved_count', house, '7')), '23514');
  PERFORM pg_temp.expect('deliverance -1 rejected', pg_temp.try(format(ins, 'deliverance_count', house, '-1')), '23514');
  PERFORM pg_temp.expect('guest 500 ok', pg_temp.try(format(ins, 'guest_count', house, '500')), 'ok');
  PERFORM pg_temp.expect('guest 501 rejected', pg_temp.try(format(ins, 'guest_count', house, '501')), '23514');
  PERFORM pg_temp.expect('leader score 1 ok', pg_temp.try(format(ins, 'leader_score', house, '1')), 'ok');
  PERFORM pg_temp.expect('leader score 0 rejected', pg_temp.try(format(ins, 'leader_score', house, '0')), '23514');
  PERFORM pg_temp.expect('welcome score 6 rejected', pg_temp.try(format(ins, 'welcome_score', house, '6')), '23514');
  PERFORM pg_temp.expect('testimonies 2000 chars ok',
    pg_temp.try(format(ins, 'testimonies', house, quote_literal(repeat('x', 2000)))), 'ok');
  PERFORM pg_temp.expect('testimonies 2001 chars rejected',
    pg_temp.try(format(ins, 'testimonies', house, quote_literal(repeat('x', 2001)))), '23514');
  PERFORM pg_temp.expect('win_type 201 chars rejected',
    pg_temp.try(format(ins, 'win_type', house, quote_literal(repeat('x', 201)))), '23514');
  PERFORM pg_temp.expect('21 training needs rejected',
    pg_temp.try(format(ins, 'training_needs', house, 'array_fill(''x''::text, ARRAY[21])')), '23514');
  PERFORM pg_temp.expect('same house + date still unique',
    pg_temp.try(format(ins, 'notes', house, '''dup''') || '; ' || format(ins, 'notes', house, '''dup''')), '23505');

  -- forms checks.
  PERFORM pg_temp.expect('unknown kind rejected',
    pg_temp.try($q$INSERT INTO public.forms (slug, name, schema, kind) VALUES ('k', 'k', '{}', 'survey')$q$), '23514');
  PERFORM pg_temp.expect('unknown access mode rejected',
    pg_temp.try($q$INSERT INTO public.forms (slug, name, schema, access_mode) VALUES ('a', 'a', '{}', 'secret')$q$), '23514');
  PERFORM pg_temp.expect('weekly feedback form must be about a house',
    pg_temp.try($q$INSERT INTO public.forms (slug, name, schema, kind, access_mode, subject_type)
                  VALUES ('w', 'w', '{}', 'missio_weekly_feedback', 'token', 'contact')$q$), '23514');
  PERFORM pg_temp.expect('unknown department rejected',
    pg_temp.try($q$INSERT INTO public.forms (slug, name, schema, department_id) VALUES ('d', 'd', '{}', gen_random_uuid())$q$), '23503');

  INSERT INTO public.forms (slug, name, schema, kind, access_mode, subject_type)
  VALUES ('weekly', 'Weekly', '{}', 'missio_weekly_feedback', 'token', 'house')
  RETURNING id INTO form_id;

  -- form_submissions subject.
  PERFORM pg_temp.expect('subject id without type rejected',
    pg_temp.try(format($q$INSERT INTO public.form_submissions (form_id, raw_data, dedup_action, subject_id)
                          VALUES (%L, '{}', 'new', %L)$q$, form_id, house)), '23514');
  PERFORM pg_temp.expect('unknown subject type rejected',
    pg_temp.try(format($q$INSERT INTO public.form_submissions (form_id, raw_data, dedup_action, subject_type)
                          VALUES (%L, '{}', 'new', 'planet')$q$, form_id)), '23514');

  INSERT INTO public.form_submissions (form_id, raw_data, dedup_action, subject_type, subject_id)
  VALUES (form_id, '{}', 'new', 'house', house)
  RETURNING id INTO sub_id;
  UPDATE public.missio_house_feedback SET form_submission_id = sub_id WHERE meeting_date = '2026-11-11';

  PERFORM pg_temp.expect('one feedback row per submission',
    pg_temp.try(format(ins, 'form_submission_id', house, quote_literal(sub_id))), '23505');

  DELETE FROM public.form_submissions WHERE id = sub_id;
  PERFORM pg_temp.expect('deleting the submission keeps the feedback, link set null',
    (SELECT coalesce(form_submission_id::text, 'null') || '/' || attendance
     FROM public.missio_house_feedback WHERE meeting_date = '2026-11-11'),
    'null/14');

  -- RLS unchanged.
  PERFORM pg_temp.expect('feedback still has exactly the two 339 policies',
    (SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE tablename = 'missio_house_feedback'),
    'Coaches and leaders can read their house feedback | Pastors can read house feedback');
  PERFORM pg_temp.expect('authenticated still cannot write feedback',
    (has_table_privilege('authenticated', 'public.missio_house_feedback', 'INSERT')
     OR has_table_privilege('authenticated', 'public.missio_house_feedback', 'UPDATE'))::text,
    'false');
END $$;

-- ── Ops script: house names ─────────────────────────────────

\ir ../scripts/ops/fill_house_church_names.sql
\ir ../scripts/ops/fill_house_church_names.sql

DO $$
DECLARE
  missio uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.expect('house 1 named',
    (SELECT name FROM public.house_churches WHERE org_id = missio AND number = 1), 'Johnson''s and Schoch''s');
  PERFORM pg_temp.expect('house 12 keeps its accent',
    (SELECT name FROM public.house_churches WHERE org_id = missio AND number = 12),
    'Jaco & Ashley Diederiks and Rikus & Lené Jonck');
  PERFORM pg_temp.expect('a typed name is not overwritten',
    (SELECT name FROM public.house_churches WHERE org_id = missio AND number = 2), 'Already named');
  PERFORM pg_temp.expect('a blank name is filled',
    (SELECT name FROM public.house_churches WHERE org_id = missio AND number = 3), 'Taylor Davis and Jurie Crots');
  PERFORM pg_temp.expect('all 20 Missio houses have a name',
    (SELECT count(*)::text FROM public.house_churches WHERE org_id = missio AND btrim(coalesce(name, '')) <> ''), '20');
  PERFORM pg_temp.expect('meeting day and location untouched',
    (SELECT count(*)::text FROM public.house_churches
     WHERE org_id = missio AND meeting_day = 'wednesday' AND location = 'Loc ' || number), '20');
  PERFORM pg_temp.expect('another org''s house 1 untouched',
    (SELECT coalesce(name, 'null') FROM public.house_churches
     WHERE org_id = '00000000-0000-4000-8000-000000000002' AND number = 1), 'null');
END $$;

-- ── Result ──────────────────────────────────────────────────

DO $$
DECLARE
  n_pass int;
  n_fail int;
  rec record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok) INTO n_pass, n_fail FROM checks;
  RAISE NOTICE 'hub_forms_f1_columns: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'hub_forms_f1_columns: % checks failed', n_fail;
  END IF;
END $$;
