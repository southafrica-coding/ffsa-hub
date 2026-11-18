-- Disposable role-matrix check for migration 335. Not a migration.
-- Stubs the tables 329 needs, applies 329 and 335 twice, then reads
-- and writes as a Missio pastor, a Missio house church leader, an
-- FFSA admin, anon, and the service role.
--
--   dropdb --if-exists missio_volunteer_availability && createdb missio_volunteer_availability
--   psql -v ON_ERROR_STOP=1 -d missio_volunteer_availability -f supabase/tests/missio_volunteer_availability_rls.sql
--
-- Never point this at a shared or hosted database. service_role is
-- given BYPASSRLS here because that is how Supabase's service role
-- passes a table that has no policy for it.

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
  email text,
  contact_id uuid
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  email text,
  status text NOT NULL DEFAULT 'active'
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
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id)
);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id)
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

CREATE OR REPLACE FUNCTION public.has_any_role(required_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = ANY (required_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY[required_role]);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.key = required_permission
  );
$$;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
REVOKE ALL ON public.contacts FROM anon;
CREATE POLICY "Admins and staff can read all contacts"
  ON public.contacts FOR SELECT
  USING (public.is_admin() OR public.has_permission('contacts.view'));

ALTER TABLE public.contact_labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.contact_labels TO authenticated;
REVOKE ALL ON public.contact_labels FROM anon;
CREATE POLICY "Auth users can read contact labels"
  ON public.contact_labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.labels TO authenticated;
REVOKE ALL ON public.labels FROM anon;
CREATE POLICY "Auth users can read labels"
  ON public.labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio');

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/335_missio_volunteer_availability.sql
\ir ../migrations/335_missio_volunteer_availability.sql

INSERT INTO public.roles (name) VALUES ('admin'), ('super_admin');
INSERT INTO public.permissions (key) VALUES ('contacts.view');

INSERT INTO public.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor@example.org'),
  ('a2222222-2222-2222-2222-222222222222', 'leader@example.org'),
  ('a4444444-4444-4444-4444-444444444444', 'admin@example.org'),
  ('a8888888-8888-8888-8888-888888888888', 'viewer@example.org');

INSERT INTO public.contacts (id, first_name, last_name, email) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Sam', 'Sample', 'sam.sample@example.org'),
  ('c2222222-2222-2222-2222-222222222222', 'Alex', 'Example', 'alex.example@example.org'),
  ('c3333333-3333-3333-3333-333333333333', 'Out', 'Sider', 'out.sider@example.org');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('a4444444-4444-4444-4444-444444444444', 'admin')
) AS v(uid, role)
JOIN public.users u ON u.id = v.uid::uuid
JOIN public.roles r ON r.name = v.role;

INSERT INTO public.user_permissions (user_id, permission_id)
SELECT 'a8888888-8888-8888-8888-888888888888', id
FROM public.permissions WHERE key = 'contacts.view';

INSERT INTO public.org_staff_roles (user_id, org_id, role)
SELECT v.uid::uuid, o.id, v.role
FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111', 'missio', 'pastor'),
  ('a2222222-2222-2222-2222-222222222222', 'missio', 'house_church_leader')
) AS v(uid, slug, role)
JOIN public.organisations o ON o.slug = v.slug;

INSERT INTO public.org_people (org_id, contact_id, campus)
SELECT o.id, v.cid::uuid, 'potch'
FROM (VALUES
  ('missio', 'c1111111-1111-1111-1111-111111111111'),
  ('missio', 'c2222222-2222-2222-2222-222222222222')
) AS v(slug, cid)
JOIN public.organisations o ON o.slug = v.slug;

CREATE TEMP TABLE checks (
  n serial PRIMARY KEY,
  label text NOT NULL,
  got text,
  want text,
  ok boolean NOT NULL
);

CREATE FUNCTION pg_temp.expect(label text, got text, want text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO checks (label, got, want, ok)
  VALUES (label, got, want, got IS NOT DISTINCT FROM want);
  IF got IS DISTINCT FROM want THEN
    RAISE NOTICE 'FAIL %: got [%] want [%]', label, got, want;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.become(who text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF who = 'anon' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSIF who = 'service' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE service_role';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', who, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.exec(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  RETURN 'rows=' || n;
EXCEPTION WHEN OTHERS THEN
  RETURN 'err ' || SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.scalar(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'err ' || SQLSTATE;
END;
$$;

-- ── Wall: policy text and grants ─────────────────────────

SELECT pg_temp.expect(
  'no availability policy calls is_admin, has_role, or has_permission',
  (
    SELECT count(*)::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'missio_teams',
        'missio_team_leaders',
        'missio_team_members',
        'availability_requests',
        'availability_tokens',
        'availability_responses'
      )
      AND (
        COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ 'is_admin|has_permission|has_role\('
        OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_admin|has_permission|has_role\('
      )
  ),
  '0'
);

SELECT pg_temp.expect(
  'every volunteer policy uses has_org_role missio pastor',
  (
    SELECT count(*)::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'missio_teams',
        'missio_team_leaders',
        'missio_team_members',
        'availability_requests',
        'availability_responses'
      )
      AND (
        COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%has_org_role(''missio''::text, ARRAY[''pastor''::text])%'
        OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%has_org_role(''missio''::text, ARRAY[''pastor''::text])%'
      )
  ),
  (
    SELECT count(*)::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'missio_teams',
        'missio_team_leaders',
        'missio_team_members',
        'availability_requests',
        'availability_responses'
      )
  )
);

SELECT pg_temp.expect(
  'availability_tokens has no policy',
  (
    SELECT count(*)::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'availability_tokens'
  ),
  '0'
);

SELECT pg_temp.expect(
  'anon has no grants on the new tables',
  (
    SELECT count(*)::text
    FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND table_name IN (
        'missio_teams',
        'missio_team_leaders',
        'missio_team_members',
        'availability_requests',
        'availability_tokens',
        'availability_responses'
      )
  ),
  '0'
);

SELECT pg_temp.expect(
  'authenticated has no grants on availability_tokens',
  (
    SELECT count(*)::text
    FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated'
      AND table_name = 'availability_tokens'
  ),
  '0'
);

SELECT pg_temp.expect(
  'authenticated responses grant is select only',
  (
    SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated'
      AND table_name = 'availability_responses'
  ),
  'SELECT'
);

SELECT pg_temp.expect(
  'token_hash exists and a raw token column does not',
  (
    SELECT (count(*) FILTER (WHERE column_name = 'token_hash'))::text
      || '/' ||
      (count(*) FILTER (WHERE column_name = 'token'))::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'availability_tokens'
  ),
  '1/0'
);

SELECT pg_temp.expect(
  'member and leader contact_id reference contacts',
  (
    SELECT count(*)::text
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class dst ON dst.oid = con.confrelid
    WHERE con.contype = 'f'
      AND src.relname IN ('missio_team_members', 'missio_team_leaders')
      AND dst.relname = 'contacts'
      AND con.conkey = (
        SELECT array_agg(attnum)
        FROM pg_attribute
        WHERE attrelid = src.oid
          AND attname = 'contact_id'
      )
  ),
  '2'
);

SELECT pg_temp.expect(
  'security definer volunteer functions set an empty search_path',
  (
    SELECT count(*)::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'missio_volunteer_org_is_missio',
        'missio_volunteer_contact_in_org',
        'availability_response_guard'
      )
      AND p.prosecdef
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
          AND split_part(cfg, '=', 2) IN ('', '""')
      )
  ),
  '3'
);

-- ── Pastor can manage a team. Admin cannot. ──────────────

SELECT pg_temp.expect(
  'FFSA admin is_admin is true and is not a Missio pass',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$SELECT public.is_admin()::text$$),
  'true'
);

SELECT pg_temp.expect(
  'FFSA admin has_org_role(missio) is false',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$SELECT public.has_org_role('missio')::text$$),
  'false'
);

SELECT pg_temp.expect(
  'pastor inserts a team',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.missio_teams (org_id, name)
      SELECT id, 'Sunday band' FROM public.organisations WHERE slug = 'missio'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'FFSA admin insert is rejected',
  pg_temp.exec(
    'a4444444-4444-4444-4444-444444444444',
    $$INSERT INTO public.missio_teams (org_id, name)
      SELECT id, 'Admin band' FROM public.organisations WHERE slug = 'missio'$$
  ),
  'err 42501'
);

SELECT pg_temp.expect(
  'FFSA admin sees no teams',
  pg_temp.scalar(
    'a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_teams$$
  ),
  '0'
);

SELECT pg_temp.expect(
  'house church leader sees no teams',
  pg_temp.scalar(
    'a2222222-2222-2222-2222-222222222222',
    $$SELECT count(*)::text FROM public.missio_teams$$
  ),
  '0'
);

SELECT pg_temp.expect(
  'contacts.view holder sees no teams',
  pg_temp.scalar(
    'a8888888-8888-8888-8888-888888888888',
    $$SELECT count(*)::text FROM public.missio_teams$$
  ),
  '0'
);

SELECT pg_temp.expect(
  'anon cannot read teams',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_teams$$),
  'err 42501'
);

SELECT pg_temp.expect(
  'pastor adds a member',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.missio_team_members (team_id, contact_id)
      SELECT id, 'c1111111-1111-1111-1111-111111111111'
      FROM public.missio_teams WHERE name = 'Sunday band'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'pastor adds a leader',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.missio_team_leaders (team_id, contact_id)
      SELECT id, 'c2222222-2222-2222-2222-222222222222'
      FROM public.missio_teams WHERE name = 'Sunday band'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'outsider contact cannot join a team',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.missio_team_members (team_id, contact_id)
      SELECT id, 'c3333333-3333-3333-3333-333333333333'
      FROM public.missio_teams WHERE name = 'Sunday band'$$
  ),
  'err 23503'
);

SELECT pg_temp.expect(
  'pastor creates a request',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.availability_requests (org_id, starts_on, ends_on, service_dates, created_by)
      SELECT id, '2099-01-01', '2099-01-31', ARRAY['2099-01-04'::date, '2099-01-11'::date],
             'a1111111-1111-1111-1111-111111111111'
      FROM public.organisations WHERE slug = 'missio'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'FFSA admin sees no requests',
  pg_temp.scalar(
    'a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.availability_requests$$
  ),
  '0'
);

-- ── Tokens are service-role only, hashes only ────────────

SELECT pg_temp.expect(
  'pastor cannot insert a token',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.availability_tokens (request_id, contact_id, token_hash, expires_at)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', repeat('ab', 32), '2099-02-01'
      FROM public.availability_requests$$
  ),
  'err 42501'
);

SELECT pg_temp.expect(
  'anon cannot read tokens',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.availability_tokens$$),
  'err 42501'
);

SELECT pg_temp.expect(
  'authenticated pastor cannot read tokens',
  pg_temp.scalar(
    'a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.availability_tokens$$
  ),
  'err 42501'
);

SELECT pg_temp.expect(
  'raw token text is rejected',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_tokens (request_id, contact_id, token_hash, expires_at)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', 'not-a-hash-and-not-hex-64', '2099-02-01'
      FROM public.availability_requests$$
  ),
  'err 23514'
);

SELECT pg_temp.expect(
  'service role stores a hash',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_tokens (request_id, contact_id, token_hash, expires_at)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', repeat('ab', 32), '2099-02-01'
      FROM public.availability_requests$$
  ),
  'rows=1'
);

-- ── Responses: service role, closed after the date ───────

SELECT pg_temp.expect(
  'pastor cannot insert a response',
  pg_temp.exec(
    'a1111111-1111-1111-1111-111111111111',
    $$INSERT INTO public.availability_responses (request_id, contact_id, service_date, status)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', '2099-01-04', 'available'
      FROM public.availability_requests$$
  ),
  'err 42501'
);

SELECT pg_temp.expect(
  'service role records a future answer',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_responses (request_id, contact_id, service_date, status, note)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', '2099-01-04', 'available', 'After nine'
      FROM public.availability_requests$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'a date that is not on the request is rejected',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_responses (request_id, contact_id, service_date, status)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', '2099-01-18', 'maybe'
      FROM public.availability_requests$$
  ),
  'err 23514'
);

SELECT pg_temp.expect(
  'a past service date is rejected',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_requests (org_id, starts_on, ends_on, service_dates)
      SELECT id, '2000-01-01', '2000-01-31', ARRAY['2000-01-02'::date]
      FROM public.organisations WHERE slug = 'missio'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'past response insert is closed',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_responses (request_id, contact_id, service_date, status)
      SELECT id, 'c1111111-1111-1111-1111-111111111111', '2000-01-02', 'unavailable'
      FROM public.availability_requests WHERE starts_on = '2000-01-01'$$
  ),
  'err 23514'
);

SELECT pg_temp.expect(
  'Johannesburg today is still editable',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_requests (org_id, starts_on, ends_on, service_dates)
      SELECT id,
             (timezone('Africa/Johannesburg', now()))::date - 1,
             (timezone('Africa/Johannesburg', now()))::date + 7,
             ARRAY[(timezone('Africa/Johannesburg', now()))::date]
      FROM public.organisations WHERE slug = 'missio'$$
  ),
  'rows=1'
);

SELECT pg_temp.expect(
  'today response insert succeeds',
  pg_temp.exec(
    'service',
    $$INSERT INTO public.availability_responses (request_id, contact_id, service_date, status)
      SELECT id, 'c2222222-2222-2222-2222-222222222222',
             (timezone('Africa/Johannesburg', now()))::date, 'maybe'
      FROM public.availability_requests
      WHERE (timezone('Africa/Johannesburg', now()))::date = ANY (service_dates)$$
  ),
  'rows=1'
);

-- A row that has become past cannot be edited. The trigger is
-- disabled only long enough to plant the fixture.
ALTER TABLE public.availability_responses DISABLE TRIGGER trg_availability_response_guard;
INSERT INTO public.availability_responses (request_id, contact_id, service_date, status)
SELECT id, 'c2222222-2222-2222-2222-222222222222', '2000-01-02', 'maybe'
FROM public.availability_requests WHERE starts_on = '2000-01-01';
ALTER TABLE public.availability_responses ENABLE TRIGGER trg_availability_response_guard;

SELECT pg_temp.expect(
  'updating a past response is closed',
  pg_temp.exec(
    'service',
    $$UPDATE public.availability_responses
         SET note = 'too late'
       WHERE service_date = '2000-01-02'$$
  ),
  'err 23514'
);

SELECT pg_temp.expect(
  'pastor can read the future response and not write it',
  pg_temp.scalar(
    'a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.availability_responses WHERE service_date = '2099-01-04'$$
  ),
  '1'
);

SELECT pg_temp.expect(
  'FFSA admin cannot read responses',
  pg_temp.scalar(
    'a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.availability_responses$$
  ),
  '0'
);

SELECT pg_temp.expect(
  'anon cannot read responses',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.availability_responses$$),
  'err 42501'
);

-- ── Report ───────────────────────────────────────────────

SELECT label || ' got=' || COALESCE(got, 'null') || ' want=' || want
FROM checks WHERE NOT ok;

DO $$
DECLARE
  failures int;
BEGIN
  SELECT count(*) INTO failures FROM checks WHERE NOT ok;
  IF failures > 0 THEN
    RAISE EXCEPTION '% volunteer availability RLS checks failed', failures;
  END IF;
END $$;

\echo 'missio volunteer availability RLS checks passed'
