-- Disposable check for migration 335. Not a migration.
-- Rebuilds activity_events with 043's policies, applies 335 twice,
-- then reads and writes as a student, a staff member, someone with
-- contacts.view, a comms_admin (insert + returning), an events_admin,
-- an admin, and anon.
--
--   dropdb --if-exists activity_events_select_staff && createdb activity_events_select_staff
--   psql -v ON_ERROR_STOP=1 -d activity_events_select_staff -f supabase/tests/activity_events_select_staff_rls.sql
--
-- Never point this at a shared or hosted database.

\set ON_ERROR_STOP 1
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- test.roles = comma list of role names, test.perms = comma list of permissions
CREATE OR REPLACE FUNCTION public.has_role(role_name text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT role_name = ANY (string_to_array(coalesce(current_setting('test.roles', true), ''), ','));
$$;
CREATE OR REPLACE FUNCTION public.has_any_role(role_names text[])
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT role_names && string_to_array(coalesce(current_setting('test.roles', true), ''), ',');
$$;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.has_any_role(ARRAY['super_admin','admin']);
$$;
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT required_permission = ANY (string_to_array(coalesce(current_setting('test.perms', true), ''), ','));
$$;

CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text);
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_events TO anon, authenticated;
GRANT ALL ON public.activity_events TO service_role;

-- 043 as shipped.
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can read activity events"
  ON public.activity_events FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and comms can insert activity events"
  ON public.activity_events FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('comms_admin') OR public.has_role('events_admin'));

INSERT INTO public.contacts (id, first_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Grace'),
  ('c0000000-0000-0000-0000-000000000002', 'Sipho');
INSERT INTO public.activity_events (contact_id, event_type, payload) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'note_added', '{"text":"pastoral note"}'),
  ('c0000000-0000-0000-0000-000000000002', 'email_sent', '{}');

-- Before 335 a student reads everything: proves the test sees the bug.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
SELECT set_config('test.roles', '', false);
SELECT set_config('test.perms', '', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 2 THEN
    RAISE EXCEPTION 'setup: 043 should let a student read every row';
  END IF;
END $$;
RESET ROLE;

\ir ../migrations/335_activity_events_select_staff.sql
\ir ../migrations/335_activity_events_select_staff.sql

SET ROLE authenticated;

-- Student (no role, no permission)
SELECT set_config('test.roles', '', false);
SELECT set_config('test.perms', '', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 0 THEN
    RAISE EXCEPTION 'a student can still read contact timelines';
  END IF;
END $$;

-- staff role
SELECT set_config('test.roles', 'staff', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 2 THEN
    RAISE EXCEPTION 'staff lost the timeline';
  END IF;
END $$;

-- contacts.view / contacts.read without a role
SELECT set_config('test.roles', '', false);
SELECT set_config('test.perms', 'contacts.view', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 2 THEN
    RAISE EXCEPTION 'contacts.view lost the timeline';
  END IF;
END $$;
SELECT set_config('test.perms', 'contacts.read', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 2 THEN
    RAISE EXCEPTION 'contacts.read lost the timeline';
  END IF;
END $$;
-- an unrelated permission is not enough
SELECT set_config('test.perms', 'schools.view', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 0 THEN
    RAISE EXCEPTION 'schools.view alone reads contact timelines';
  END IF;
END $$;

-- comms_admin: insert ... returning still works (logActivity does .select())
SELECT set_config('test.perms', '', false);
SELECT set_config('test.roles', 'comms_admin', false);
DO $$ DECLARE new_id uuid; BEGIN
  INSERT INTO public.activity_events (contact_id, event_type)
  VALUES ('c0000000-0000-0000-0000-000000000002', 'email_opened')
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN RAISE EXCEPTION 'comms_admin insert returned nothing'; END IF;
END $$;

-- events_admin and admin
SELECT set_config('test.roles', 'events_admin', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 3 THEN
    RAISE EXCEPTION 'events_admin lost the timeline';
  END IF;
END $$;
SELECT set_config('test.roles', 'admin', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.activity_events) <> 3 THEN
    RAISE EXCEPTION 'admin lost the timeline';
  END IF;
END $$;

-- a student still cannot insert
SELECT set_config('test.roles', '', false);
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    INSERT INTO public.activity_events (contact_id, event_type)
    VALUES ('c0000000-0000-0000-0000-000000000001', 'note_added');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'a student wrote to a timeline'; END IF;
END $$;

RESET ROLE;
SET ROLE anon;
DO $$ DECLARE blocked boolean := false; BEGIN
  BEGIN
    PERFORM 1 FROM public.activity_events;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'anon can still query activity_events'; END IF;
END $$;

RESET ROLE;
\echo 'activity_events_select_staff_rls: all checks passed'
