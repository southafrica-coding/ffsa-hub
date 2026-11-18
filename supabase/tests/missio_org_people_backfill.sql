-- Disposable check for supabase/scripts/missio_org_people_backfill.sql.
-- Fake contacts only. Applies 329 and 331, runs the script twice as
-- the service role, and checks the second run inserts nothing.
--
--   dropdb --if-exists missio_org_people_backfill && createdb missio_org_people_backfill
--   psql -v ON_ERROR_STOP=1 -d missio_org_people_backfill -f supabase/tests/missio_org_people_backfill.sql
--
-- Never point this at a shared or hosted database.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text
);
CREATE TABLE public.labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL
);
CREATE TABLE public.contact_labels (
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.labels (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_via text NOT NULL,
  added_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (contact_id, label_id)
);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio'), ('other', 'Other');

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/331_missio_house_churches.sql

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users (id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
GRANT SELECT ON public.labels, public.contacts, public.contact_labels TO service_role;

INSERT INTO public.contacts (id, first_name, last_name) VALUES
  ('c1010101-0101-4101-8101-010101010101', 'Fixture', 'One'),
  ('c2020202-0202-4202-8202-020202020202', 'Fixture', 'Two'),
  ('c3030303-0303-4303-8303-030303030303', 'Fixture', 'Three'),
  ('c4040404-0404-4404-8404-040404040404', 'Fixture', 'Four');

INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT c.id, l.id, 'manual'
FROM public.contacts c
JOIN public.labels l ON l.slug = 'missio'
WHERE c.id IN (
  'c1010101-0101-4101-8101-010101010101',
  'c2020202-0202-4202-8202-020202020202',
  'c3030303-0303-4303-8303-030303030303'
);

INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT c.id, l.id, 'manual'
FROM public.contacts c
JOIN public.labels l ON l.slug = 'other'
WHERE c.id = 'c4040404-0404-4404-8404-040404040404';

INSERT INTO public.org_people (org_id, contact_id, campus, status)
SELECT id, 'c1010101-0101-4101-8101-010101010101', 'potch', 'visitor'
FROM public.organisations WHERE slug = 'missio';

SET ROLE service_role;
\set dry_run 0
\ir ../scripts/missio_org_people_backfill.sql
RESET ROLE;

DO $$
DECLARE
  v_changes jsonb;
BEGIN
  IF (SELECT count(*) FROM public.org_people) <> 3 THEN
    RAISE EXCEPTION 'first run org_people count';
  END IF;
  IF (SELECT status FROM public.org_people
      WHERE contact_id = 'c1010101-0101-4101-8101-010101010101') <> 'visitor' THEN
    RAISE EXCEPTION 'already present row was updated';
  END IF;
  IF (SELECT count(*) FROM public.org_people
      WHERE contact_id IN (
        'c2020202-0202-4202-8202-020202020202',
        'c3030303-0303-4303-8303-030303030303'
      )
      AND campus = 'potch'
      AND status = 'active'
      AND created_by IS NULL) <> 2 THEN
    RAISE EXCEPTION 'new rows were not inserted as active potch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.org_people
    WHERE contact_id = 'c4040404-0404-4404-8404-040404040404'
  ) THEN
    RAISE EXCEPTION 'unlabelled contact was inserted';
  END IF;
  IF (SELECT added_via FROM public.contact_labels cl
      JOIN public.labels l ON l.id = cl.label_id
      WHERE cl.contact_id = 'c2020202-0202-4202-8202-020202020202'
        AND l.slug = 'missio') <> 'manual' THEN
    RAISE EXCEPTION 'existing label provenance was overwritten';
  END IF;

  SELECT changes INTO v_changes
  FROM public.audit_logs
  WHERE action = 'missio_org_people_backfill';
  IF v_changes IS NULL
     OR v_changes->>'candidates' <> '3'
     OR v_changes->>'inserted' <> '2'
     OR v_changes->>'already_present' <> '1'
     OR v_changes->>'skipped' <> '0'
     OR v_changes->>'skipped_reasons' <> 'none' THEN
    RAISE EXCEPTION 'first run audit counts %', v_changes;
  END IF;
END $$;

SET ROLE service_role;
\ir ../scripts/missio_org_people_backfill.sql
RESET ROLE;

DO $$
DECLARE
  v_changes jsonb;
BEGIN
  IF (SELECT count(*) FROM public.org_people) <> 3 THEN
    RAISE EXCEPTION 'second run changed the row count';
  END IF;
  SELECT changes INTO v_changes
  FROM public.audit_logs
  WHERE action = 'missio_org_people_backfill'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_changes->>'inserted' <> '0'
     OR v_changes->>'already_present' <> '3'
     OR v_changes->>'candidates' <> '3'
     OR v_changes->>'skipped' <> '0' THEN
    RAISE EXCEPTION 'second run audit counts %', v_changes;
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action = 'missio_org_people_backfill') <> 2 THEN
    RAISE EXCEPTION 'expected one audit row per run';
  END IF;
END $$;

INSERT INTO public.contacts (id, first_name, last_name)
VALUES ('c5050505-0505-4505-8505-050505050505', 'Fixture', 'Five');
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c5050505-0505-4505-8505-050505050505', id, 'manual'
FROM public.labels WHERE slug = 'missio';

\set ON_ERROR_STOP off
\set dry_run 1
\ir ../scripts/missio_org_people_backfill.sql
\set ON_ERROR_STOP on
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.org_people
    WHERE contact_id = 'c5050505-0505-4505-8505-050505050505'
  ) THEN
    RAISE EXCEPTION 'dry run wrote a row';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action = 'missio_org_people_backfill') <> 2 THEN
    RAISE EXCEPTION 'dry run wrote an audit row';
  END IF;
  RAISE NOTICE 'missio_org_people_backfill_test: passed';
END $$;
