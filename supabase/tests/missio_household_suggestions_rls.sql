-- Disposable role-matrix check for migration 398. Not a migration.
-- Stubs the few FFSA objects 398 references (organisations, contacts,
-- users, has_org_role_id over a stub org_staff_roles), applies 398 twice,
-- then reads and writes as a Missio pastor, a Missio house church leader
-- (not a pastor), a pastor of another org, anon, and the service role.
--
--   dropdb --if-exists missio_household_suggestions && createdb missio_household_suggestions
--   psql -v ON_ERROR_STOP=1 -d missio_household_suggestions -f supabase/tests/missio_household_suggestions_rls.sql
--
-- Never point this at a shared or hosted database. service_role is given
-- BYPASSRLS here because that is how Supabase's service role passes a
-- table that has no policy for it. Names are made up.

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

-- Hosted Supabase grants new public tables and functions to anon and
-- authenticated. 398 must revoke and tighten.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organisations (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text);
CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.org_staff_roles (user_id uuid NOT NULL, org_id uuid NOT NULL, role text NOT NULL);

-- Same shape as 329's helper.
CREATE OR REPLACE FUNCTION public.has_org_role_id(p_org_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_staff_roles r
    WHERE r.user_id = auth.uid() AND r.org_id = p_org_id AND r.role = ANY (p_roles)
  );
$$;

INSERT INTO public.organisations (id, slug) VALUES
  ('0a000000-0000-4000-8000-000000000001', 'missio'),
  ('0a000000-0000-4000-8000-000000000002', 'other-church');
INSERT INTO public.users (id) VALUES
  ('a1111111-1111-1111-1111-111111111111'),  -- Missio pastor
  ('a2222222-2222-2222-2222-222222222222'),  -- Missio house church leader
  ('a3333333-3333-3333-3333-333333333333');  -- pastor of another org
INSERT INTO public.org_staff_roles (user_id, org_id, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000001', 'pastor'),
  ('a2222222-2222-2222-2222-222222222222', '0a000000-0000-4000-8000-000000000001', 'house_church_leader'),
  ('a3333333-3333-3333-3333-333333333333', '0a000000-0000-4000-8000-000000000002', 'pastor');
INSERT INTO public.contacts (id, first_name) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Esther'),
  ('c0000000-0000-4000-8000-000000000002', 'Johan'),
  ('c0000000-0000-4000-8000-000000000003', 'Gideon'),
  ('c0000000-0000-4000-8000-000000000004', 'Riley');

\ir ../migrations/398_missio_household_suggestions.sql
\ir ../migrations/398_missio_household_suggestions.sql

-- ── Fixtures (as the table owner) ─────────────────────────
INSERT INTO public.missio_household_suggestions (id, org_id, contact_a, contact_b, source_line) VALUES
  ('e0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 12),
  ('e0000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', 30);

CREATE TEMP TABLE checks (
  n serial PRIMARY KEY,
  label text NOT NULL,
  got text,
  want text,
  ok boolean NOT NULL
);
GRANT ALL ON checks TO PUBLIC;

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
  EXECUTE 'RESET ROLE';
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
  EXECUTE 'RESET ROLE';
  RETURN 'err ' || SQLSTATE;
END;
$$;

-- pastor   a1111111-…  Missio pastor
-- leader   a2222222-…  Missio house church leader, not a pastor
-- outsider a3333333-…  pastor of another org

-- ── Reading ───────────────────────────────────────────────
SELECT pg_temp.expect('pastor reads suggestions',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$SELECT count(*)::text FROM public.missio_household_suggestions$$), '2');
SELECT pg_temp.expect('house leader sees none',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$SELECT count(*)::text FROM public.missio_household_suggestions$$), '0');
SELECT pg_temp.expect('another org''s pastor sees none',
  pg_temp.scalar('a3333333-3333-3333-3333-333333333333', $$SELECT count(*)::text FROM public.missio_household_suggestions$$), '0');
SELECT pg_temp.expect('anon cannot read',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_household_suggestions$$), 'err 42501');

-- ── Only the service role files suggestions ───────────────
SELECT pg_temp.expect('pastor cannot insert',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003')$$), 'err 42501');
SELECT pg_temp.expect('anon cannot insert',
  pg_temp.exec('anon', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003')$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot delete',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$DELETE FROM public.missio_household_suggestions$$), 'err 42501');
SELECT pg_temp.expect('pairs are stored in one order only',
  pg_temp.exec('service', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001')$$), 'err 23514');
SELECT pg_temp.expect('the same pair twice is refused',
  pg_temp.exec('service', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')$$), 'err 23505');
SELECT pg_temp.expect('the script''s upsert leaves an existing row alone',
  pg_temp.exec('service', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')
    ON CONFLICT (org_id, contact_a, contact_b) DO NOTHING$$), 'rows=0');
SELECT pg_temp.expect('a person is not a couple with themselves',
  pg_temp.exec('service', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')$$), 'err 23514');

-- ── Pastors review ────────────────────────────────────────
SELECT pg_temp.expect('house leader cannot review',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$UPDATE public.missio_household_suggestions SET status = 'accepted'$$), 'rows=0');
SELECT pg_temp.expect('another org''s pastor cannot review',
  pg_temp.exec('a3333333-3333-3333-3333-333333333333', $$UPDATE public.missio_household_suggestions SET status = 'accepted'$$), 'rows=0');
SELECT pg_temp.expect('pastor cannot change the pair',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_household_suggestions
    SET contact_b = 'c0000000-0000-4000-8000-000000000003' WHERE id = 'e0000000-0000-4000-8000-000000000001'$$), 'err 42501');
SELECT pg_temp.expect('pastor accepts, naming someone else as reviewer',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_household_suggestions
    SET status = 'accepted', reviewed_by = 'a3333333-3333-3333-3333-333333333333'
    WHERE id = 'e0000000-0000-4000-8000-000000000001' AND status = 'pending' RETURNING id$$), 'rows=1');
SELECT pg_temp.expect('…and is stamped as themselves',
  (SELECT status || '/' || reviewed_by::text || '/' || (reviewed_at IS NOT NULL)::text
     FROM public.missio_household_suggestions WHERE id = 'e0000000-0000-4000-8000-000000000001'),
  'accepted/a1111111-1111-1111-1111-111111111111/true');
SELECT pg_temp.expect('a reviewed suggestion cannot be reopened',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_household_suggestions
    SET status = 'pending' WHERE id = 'e0000000-0000-4000-8000-000000000001'$$), 'err 23514');
SELECT pg_temp.expect('…or swapped to the other answer',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_household_suggestions
    SET status = 'dismissed' WHERE id = 'e0000000-0000-4000-8000-000000000001'$$), 'err 23514');
SELECT pg_temp.expect('pastor dismisses the other',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_household_suggestions
    SET status = 'dismissed' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$), 'rows=1');
SELECT pg_temp.expect('a bad status is refused',
  pg_temp.exec('service', $$UPDATE public.missio_household_suggestions SET status = 'maybe'
    WHERE id = 'e0000000-0000-4000-8000-000000000002'$$), 'err 23514');
SELECT pg_temp.expect('the upsert does not reset a dismissed row',
  pg_temp.exec('service', $$INSERT INTO public.missio_household_suggestions (org_id, contact_a, contact_b)
    VALUES ('0a000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004')
    ON CONFLICT (org_id, contact_a, contact_b) DO NOTHING$$), 'rows=0');
SELECT pg_temp.expect('…still dismissed',
  (SELECT status FROM public.missio_household_suggestions WHERE id = 'e0000000-0000-4000-8000-000000000002'), 'dismissed');
SELECT pg_temp.expect('no seed rows beyond these fixtures',
  (SELECT count(*)::text FROM public.missio_household_suggestions), '2');

-- ── Report ────────────────────────────────────────────────
DO $$
DECLARE
  n_pass int;
  n_fail int;
  rec record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)
    INTO n_pass, n_fail
  FROM checks;
  RAISE NOTICE 'missio_household_suggestions_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_household_suggestions_rls: % checks failed', n_fail;
  END IF;
END $$;
