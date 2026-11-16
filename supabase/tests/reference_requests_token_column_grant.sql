-- Disposable column-grant check for migration 328. Not a migration.
-- Creates a stand-in reference_requests with the table-wide SELECT the
-- leak depends on, applies 328 twice, and checks privileges. RLS is left
-- off on purpose: this file tests column grants, not the row policies.
--
--   dropdb --if-exists reference_token_grant && createdb reference_token_grant
--   psql -v ON_ERROR_STOP=1 -d reference_token_grant -f supabase/tests/reference_requests_token_column_grant.sql
--
-- Do not point this at a shared or remote database.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.reference_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  referee_name text NOT NULL,
  referee_email text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  relationship text,
  known_duration text,
  reference_text text,
  form_data jsonb,
  submitted_at timestamptz,
  email_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The leak: table-wide SELECT, plus the write grants this migration must leave.
GRANT SELECT, INSERT, UPDATE ON TABLE public.reference_requests TO anon, authenticated;
GRANT ALL ON TABLE public.reference_requests TO service_role;

INSERT INTO public.reference_requests (application_id, slot_id, referee_name, referee_email, token)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Pat',
  'pat@example.test',
  'secret-token'
);

\ir ../migrations/328_reference_requests_hide_token.sql
\ir ../migrations/328_reference_requests_hide_token.sql

-- authenticated can read a safe column and cannot read token or star.
SET ROLE authenticated;

DO $$
DECLARE
  seen text;
BEGIN
  SELECT status INTO seen FROM public.reference_requests;
  IF seen IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'authenticated could not read status (got %)', seen;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM token FROM public.reference_requests;
    RAISE EXCEPTION 'authenticated read token';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  BEGIN
    SELECT * INTO r FROM public.reference_requests;
    RAISE EXCEPTION 'authenticated read star';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- RETURNING token must fail closed. The write grants stay; the secret does not come back.
DO $$
DECLARE
  leaked text;
BEGIN
  BEGIN
    INSERT INTO public.reference_requests (application_id, slot_id, referee_name, referee_email, token)
    VALUES (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'New',
      'new@example.test',
      'chosen-by-insert'
    )
    RETURNING token INTO leaked;
    RAISE EXCEPTION 'insert returning token leaked %', leaked;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  kept uuid;
BEGIN
  INSERT INTO public.reference_requests (application_id, slot_id, referee_name, referee_email, token)
  VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Kept',
    'kept@example.test',
    'kept-token'
  )
  RETURNING id INTO kept;
  IF kept IS NULL THEN
    RAISE EXCEPTION 'insert returning id failed';
  END IF;
END $$;

DO $$
DECLARE
  leaked text;
BEGIN
  BEGIN
    UPDATE public.reference_requests
       SET status = 'submitted'
     WHERE referee_email = 'pat@example.test'
    RETURNING token INTO leaked;
    RAISE EXCEPTION 'update returning token leaked %', leaked;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reference_requests WHERE status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'failed returning update still wrote the row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reference_requests WHERE referee_email = 'kept@example.test'
  ) THEN
    RAISE EXCEPTION 'insert returning id did not keep the row';
  END IF;
END $$;

-- anon lost SELECT. INSERT was not revoked.
SET ROLE anon;

DO $$
BEGIN
  BEGIN
    PERFORM id FROM public.reference_requests;
    RAISE EXCEPTION 'anon read a column';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;

DO $$
DECLARE
  cols text[];
  expected text[] := ARRAY[
    'id', 'application_id', 'slot_id', 'referee_name', 'referee_email', 'status',
    'relationship', 'known_duration', 'reference_text', 'form_data', 'submitted_at',
    'email_sent_at', 'reminder_sent_at', 'created_at', 'updated_at'
  ];
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO cols
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'reference_requests'
    AND grantee = 'authenticated'
    AND privilege_type = 'SELECT';

  IF cols IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(expected) AS x) THEN
    RAISE EXCEPTION 'authenticated column grant is %, expected %', cols, expected;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'reference_requests'
      AND grantee = 'anon'
      AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon still has a column SELECT grant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'reference_requests'
      AND grantee = 'authenticated'
      AND privilege_type = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'reference_requests'
      AND grantee = 'authenticated'
      AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated lost INSERT or UPDATE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'reference_requests'
      AND grantee = 'anon'
      AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'anon lost INSERT';
  END IF;
END $$;

SET ROLE service_role;

DO $$
DECLARE
  seen text;
BEGIN
  SELECT token INTO seen FROM public.reference_requests WHERE referee_email = 'pat@example.test';
  IF seen IS DISTINCT FROM 'secret-token' THEN
    RAISE EXCEPTION 'service_role could not read token (got %)', seen;
  END IF;
END $$;

RESET ROLE;

\echo 'reference_requests token column grant checks passed'
