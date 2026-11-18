-- Disposable role-matrix check for migration 331. Not a migration.
-- Stubs the FFSA tables and helpers 329 calls, applies 329 and 331
-- twice, then reads and writes as a Missio pastor, a Missio org
-- admin who is not a pastor, a Missio house-church leader, an FFSA
-- admin, an FFSA super_admin, and anon.
--
--   dropdb --if-exists missio_house_churches && createdb missio_house_churches
--   psql -v ON_ERROR_STOP=1 -d missio_house_churches -f supabase/tests/missio_house_churches_rls.sql
--
-- Never point this at a shared or hosted database. service_role is
-- given BYPASSRLS here because that is how Supabase's service role
-- passes the hard wall (there is no policy for it to pass).

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
  phone text,
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = ANY (required_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(
  required_role text,
  check_scope_type text DEFAULT NULL,
  check_scope_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY[required_role]);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.key = required_permission
  );
$$;

-- Hosted Supabase grants new public tables and functions to anon and
-- authenticated. 331 must revoke anon and tighten authenticated.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio');

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/331_missio_house_churches.sql
\ir ../migrations/331_missio_house_churches.sql

-- Fixed house ids so denied writes name a real row, not a lookup
-- the caller cannot see.
UPDATE public.house_churches hc
   SET id = ('00000000-0000-4000-8000-' || lpad(hc.number::text, 12, '0'))::uuid
  FROM public.organisations o
 WHERE o.id = hc.org_id
   AND o.slug = 'missio';

-- ── Fixtures ──────────────────────────────────────────────
-- pastor       Missio pastor. No FFSA role.
-- org_admin    Missio org role 'admin'. Not a pastor.
-- leader       Missio house_church_leader. Not a pastor.
-- admin        FFSA admin. No org role. Hard wall.
-- sup          FFSA super_admin. No org role. Hard wall.

INSERT INTO public.roles (name) VALUES ('staff'), ('admin'), ('super_admin');

INSERT INTO public.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor@test'),
  ('a9999999-9999-9999-9999-999999999999', 'org-admin@test'),
  ('a2222222-2222-2222-2222-222222222222', 'leader@test'),
  ('a4444444-4444-4444-4444-444444444444', 'admin@test'),
  ('a5555555-5555-5555-5555-555555555555', 'super@test');

INSERT INTO public.contacts (id, first_name, last_name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Fixture', 'One'),
  ('c2222222-2222-2222-2222-222222222222', 'Fixture', 'Two'),
  ('c3333333-3333-3333-3333-333333333333', 'Fixture', 'Three'),
  ('c4444444-4444-4444-4444-444444444444', 'Fixture', 'Four');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('a4444444-4444-4444-4444-444444444444', 'admin'),
  ('a5555555-5555-5555-5555-555555555555', 'super_admin')
) AS v(uid, role)
JOIN public.users u ON u.id = v.uid::uuid
JOIN public.roles r ON r.name = v.role;

INSERT INTO public.org_staff_roles (user_id, org_id, role)
SELECT v.uid::uuid, o.id, v.role
FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111', 'missio', 'pastor'),
  ('a9999999-9999-9999-9999-999999999999', 'missio', 'admin'),
  ('a2222222-2222-2222-2222-222222222222', 'missio', 'house_church_leader')
) AS v(uid, slug, role)
JOIN public.organisations o ON o.slug = v.slug;

-- Service role puts people into org_people before a pastor may
-- give them a house. Fixture Five stays out, on purpose.
INSERT INTO public.org_people (org_id, contact_id, campus, status)
SELECT o.id, v.cid::uuid, 'potch', v.status
FROM (VALUES
  ('c1111111-1111-1111-1111-111111111111', 'active'),
  ('c2222222-2222-2222-2222-222222222222', 'visitor'),
  ('c3333333-3333-3333-3333-333333333333', 'active'),
  ('c4444444-4444-4444-4444-444444444444', 'active')
) AS v(cid, status)
JOIN public.organisations o ON o.slug = 'missio';

INSERT INTO public.contacts (id, first_name, last_name)
VALUES ('c5555555-5555-5555-5555-555555555555', 'Outside', 'Person');

-- A house that is not Missio. Pastors must not see it or write it.
INSERT INTO public.house_churches (id, org_id, number, campus)
SELECT '00000000-0000-4000-8000-0000000000ff', id, 1, 'potch'
FROM public.organisations WHERE slug = 'ffsa';

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

CREATE FUNCTION pg_temp.fail(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt;
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
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

-- ── Seed ──────────────────────────────────────────────────
SELECT pg_temp.expect(
  'seed: 20 potch houses, names null, numbers 1..20',
  (SELECT count(*)::text || '/' ||
          count(*) FILTER (WHERE hc.campus = 'potch' AND hc.name IS NULL)::text || '/' ||
          min(hc.number)::text || '/' || max(hc.number)::text
     FROM public.house_churches hc
     JOIN public.organisations o ON o.id = hc.org_id
    WHERE o.slug = 'missio'),
  '20/20/1/20'
);
SELECT pg_temp.expect(
  'seed: second apply did not duplicate the 20 houses',
  (SELECT count(*)::text FROM public.house_churches hc
    JOIN public.organisations o ON o.id = hc.org_id
    WHERE o.slug = 'missio'),
  '20'
);
SELECT pg_temp.expect(
  'seed: import review has no rows and no names',
  (SELECT count(*)::text FROM public.missio_import_review),
  '0'
);

-- ── Pastor can read and write ─────────────────────────────
SELECT pg_temp.expect('pastor sees the 20 Missio houses and not the ffsa house',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           count(*) FILTER (WHERE number = 1)::text
    FROM public.house_churches
  $$),
  '20/1');
SELECT pg_temp.expect('pastor can update a house',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_churches
       SET meeting_day = 'wednesday', location = 'Fixture lounge'
     WHERE id = '00000000-0000-4000-8000-000000000001'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor house update stuck and moved updated_at',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT meeting_day || '/' || location || '/' || (updated_at > created_at)::text
    FROM public.house_churches
    WHERE id = '00000000-0000-4000-8000-000000000001'
  $$),
  'wednesday/Fixture lounge/true');
SELECT pg_temp.expect('pastor can insert a house',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_churches (org_id, number)
    SELECT id, 21 FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor cannot delete a house',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.house_churches
    WHERE number = 21
      AND org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
  $$),
  'err 42501');
SELECT pg_temp.expect('service role can delete the extra house',
  pg_temp.exec('service', $$
    DELETE FROM public.house_churches
    WHERE number = 21
      AND org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor cannot park a house on the ffsa org',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_churches (org_id, number)
    SELECT id, 2 FROM public.organisations WHERE slug = 'ffsa'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot add a contact who is not in org_people',
  pg_temp.fail('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c5555555-5555-5555-5555-555555555555',
      'member'
    )
  $$),
  '23503 missio_member_not_in_org');
SELECT pg_temp.expect('service role cannot add a contact who is not in org_people',
  pg_temp.fail('service', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role, created_by)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c5555555-5555-5555-5555-555555555555',
      'member',
      'a4444444-4444-4444-4444-444444444444'
    )
  $$),
  '23503 missio_member_not_in_org');
SELECT pg_temp.expect('is_missio_member stays false for that contact',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT public.is_missio_member('c5555555-5555-5555-5555-555555555555')::text
  $$),
  'false');
SELECT pg_temp.expect('pastor can add a member',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role, created_by)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c1111111-1111-1111-1111-111111111111',
      'co_leader',
      'a1111111-1111-1111-1111-111111111111'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor reads that member back',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT role || '/' || contact_id::text || '/' || created_by::text
    FROM public.house_church_members
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'co_leader/c1111111-1111-1111-1111-111111111111/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('authenticated created_by is pinned to the caller',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (
      house_church_id, contact_id, role, created_by
    ) VALUES (
      '00000000-0000-4000-8000-000000000005',
      'c3333333-3333-3333-3333-333333333333',
      'member',
      'a4444444-4444-4444-4444-444444444444'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('the spoofed created_by was overwritten',
  (SELECT created_by::text FROM public.house_church_members
    WHERE house_church_id = '00000000-0000-4000-8000-000000000005'
      AND contact_id = 'c3333333-3333-3333-3333-333333333333'
      AND ended_at IS NULL),
  'a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('pastor cannot delete a membership',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.house_church_members
    WHERE house_church_id = '00000000-0000-4000-8000-000000000005'
      AND contact_id = 'c3333333-3333-3333-3333-333333333333'
  $$),
  'err 42501');
SELECT pg_temp.expect('service role can delete that membership',
  pg_temp.exec('service', $$
    DELETE FROM public.house_church_members
    WHERE house_church_id = '00000000-0000-4000-8000-000000000005'
      AND contact_id = 'c3333333-3333-3333-3333-333333333333'
  $$),
  'rows=1');
SELECT pg_temp.expect('sheet role leader2 is not a role',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      'c1111111-1111-1111-1111-111111111111',
      'leader2'
    )
  $$),
  'err 23514');
SELECT pg_temp.expect('pastor soft-ends a membership instead of deleting it',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET ended_at = current_date
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
       AND ended_at IS NULL
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor cannot change the contact on a membership',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET contact_id = 'c3333333-3333-3333-3333-333333333333'
     WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot backdate started_at',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET started_at = current_date - 7
     WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
       AND ended_at IS NULL
  $$),
  'err 42501');

-- ── Hard wall ─────────────────────────────────────────────
SELECT pg_temp.expect('HARD WALL admin is_admin() true and not a pastor',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$
    SELECT public.is_admin()::text || '/' ||
           public.has_org_role('missio', ARRAY['pastor'])::text
  $$),
  'true/false');
SELECT pg_temp.expect('HARD WALL admin sees 0 house churches',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.house_churches$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 members',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.house_church_members$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 import review',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_import_review$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 member status',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_member_status$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin cannot insert a house',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.house_churches (org_id, number)
    SELECT id, 22 FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot insert a member',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c3333333-3333-3333-3333-333333333333',
      'member'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot update a house',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    UPDATE public.house_churches SET location = 'nope'
    WHERE id = '00000000-0000-4000-8000-000000000001'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL admin cannot delete a house',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    DELETE FROM public.house_churches
    WHERE id = '00000000-0000-4000-8000-000000000001'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL super_admin is_admin() true',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT public.is_admin()::text$$),
  'true');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 houses',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.house_churches$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 members',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.house_church_members$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 member status',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.missio_member_status$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin cannot insert a member',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c3333333-3333-3333-3333-333333333333',
      'member'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL super_admin cannot update a house',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    UPDATE public.house_churches SET location = 'nope'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL super_admin is_missio_member is false',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'false');
SELECT pg_temp.expect('Missio org admin is not a pastor and is_admin() is false',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999', $$
    SELECT public.has_org_role('missio', ARRAY['admin'])::text || '/' ||
           public.has_org_role('missio', ARRAY['pastor'])::text || '/' ||
           public.is_admin()::text
  $$),
  'true/false/false');
SELECT pg_temp.expect('Missio org admin sees 0 houses',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.house_churches$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 members',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.house_church_members$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 import review',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_import_review$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 member status',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_member_status$$),
  '0');
SELECT pg_temp.expect('Missio org admin cannot insert a house',
  pg_temp.exec('a9999999-9999-9999-9999-999999999999', $$
    INSERT INTO public.house_churches (org_id, number)
    SELECT id, 23 FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('Missio org admin cannot insert a member',
  pg_temp.exec('a9999999-9999-9999-9999-999999999999', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c3333333-3333-3333-3333-333333333333',
      'member'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('Missio org admin cannot update a house',
  pg_temp.exec('a9999999-9999-9999-9999-999999999999', $$
    UPDATE public.house_churches SET location = 'nope'
    WHERE id = '00000000-0000-4000-8000-000000000001'
  $$),
  'rows=0');
SELECT pg_temp.expect('house church leader sees 0 houses',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222',
    $$SELECT count(*)::text FROM public.house_churches$$),
  '0');
SELECT pg_temp.expect('house church leader cannot insert a member',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c3333333-3333-3333-3333-333333333333',
      'leader'
    )
  $$),
  'err 42501');

-- ── Anon ──────────────────────────────────────────────────
SELECT pg_temp.expect('anon cannot read house churches',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.house_churches$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read members',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.house_church_members$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read import review',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_import_review$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read member status',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_member_status$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot call is_missio_member',
  pg_temp.scalar('anon', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'err 42501');

-- ── Unique open membership, two houses, derived status ───
SELECT pg_temp.expect('pastor adds Fixture Two to house 1',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c2222222-2222-2222-2222-222222222222',
      'member'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('open membership blocks a duplicate in the same house',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c2222222-2222-2222-2222-222222222222',
      'leader'
    )
  $$),
  'err 23505');
SELECT pg_temp.expect('pastor ends the house 1 row',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET ended_at = current_date
     WHERE house_church_id = '00000000-0000-4000-8000-000000000001'
       AND contact_id = 'c2222222-2222-2222-2222-222222222222'
       AND ended_at IS NULL
  $$),
  'rows=1');
SELECT pg_temp.expect('ending today drops the person out of member status',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text FROM public.missio_member_status
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
  $$),
  '0');
SELECT pg_temp.expect('pastor is_missio_member is false once the row has ended',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'false');
SELECT pg_temp.expect('ending the row allows a new open membership',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c2222222-2222-2222-2222-222222222222',
      'member'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('the same person can also be open in house 2',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      'c2222222-2222-2222-2222-222222222222',
      'leader'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('active_house_count is 2 with both houses and both roles',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT active_house_count::text || '/' || house_numbers::text || '/' ||
           roles::text || '/' || is_member::text
    FROM public.missio_member_status
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
  $$),
  '2/{1,2}/{leader,member}/true');
SELECT pg_temp.expect('pastor is_missio_member is true for the two-house person',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'true');
SELECT pg_temp.expect('Missio org admin is_missio_member stays false',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'false');
SELECT pg_temp.expect('HARD WALL admin is_missio_member stays false',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$
    SELECT public.is_missio_member('c2222222-2222-2222-2222-222222222222')::text
  $$),
  'false');
SELECT pg_temp.expect('pastor cannot store a future start date',
  pg_temp.fail('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role, started_at)
    VALUES (
      '00000000-0000-4000-8000-000000000003',
      'c3333333-3333-3333-3333-333333333333',
      'member',
      current_date + 1
    )
  $$),
  '23514 missio_started_at_in_future');
SELECT pg_temp.expect('service role cannot store a future start date',
  pg_temp.fail('service', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role, started_at, created_by)
    VALUES (
      '00000000-0000-4000-8000-000000000003',
      'c3333333-3333-3333-3333-333333333333',
      'member',
      current_date + 1,
      'a4444444-4444-4444-4444-444444444444'
    )
  $$),
  '23514 missio_started_at_in_future');
SELECT pg_temp.expect('a rejected future start left no membership',
  (SELECT count(*)::text FROM public.house_church_members
    WHERE contact_id = 'c3333333-3333-3333-3333-333333333333'),
  '0');
SELECT pg_temp.expect('a future end date is rejected',
  pg_temp.fail('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (
      house_church_id, contact_id, role, ended_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000004',
      'c4444444-4444-4444-4444-444444444444',
      'member',
      current_date + 7
    )
  $$),
  '23514 missio_ended_at_in_future');
SELECT pg_temp.expect('service role cannot store a future end date',
  pg_temp.fail('service', $$
    INSERT INTO public.house_church_members (
      house_church_id, contact_id, role, ended_at, created_by
    ) VALUES (
      '00000000-0000-4000-8000-000000000006',
      'c4444444-4444-4444-4444-444444444444',
      'member',
      current_date + 3,
      'a4444444-4444-4444-4444-444444444444'
    )
  $$),
  '23514 missio_ended_at_in_future');
SELECT pg_temp.expect('the rejected future end left no membership',
  (SELECT count(*)::text FROM public.house_church_members
    WHERE contact_id = 'c4444444-4444-4444-4444-444444444444'),
  '0');
SELECT pg_temp.expect('an open row is current and a same-day end is not',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000004',
      'c4444444-4444-4444-4444-444444444444',
      'member'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('open row counts as a member',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT active_house_count::text
    FROM public.missio_member_status
    WHERE contact_id = 'c4444444-4444-4444-4444-444444444444'
  $$),
  '1');
SELECT pg_temp.expect('ending that row today drops them',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET ended_at = current_date
     WHERE contact_id = 'c4444444-4444-4444-4444-444444444444'
       AND ended_at IS NULL
  $$),
  'rows=1');
SELECT pg_temp.expect('service role keeps created_by and can end a membership today',
  pg_temp.exec('service', $$
    INSERT INTO public.house_church_members (
      house_church_id, contact_id, role, created_by
    ) VALUES (
      '00000000-0000-4000-8000-000000000006',
      'c4444444-4444-4444-4444-444444444444',
      'leader',
      'a4444444-4444-4444-4444-444444444444'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('service role created_by was kept',
  (SELECT created_by::text FROM public.house_church_members
    WHERE house_church_id = '00000000-0000-4000-8000-000000000006'
      AND ended_at IS NULL),
  'a4444444-4444-4444-4444-444444444444');
SELECT pg_temp.expect('service role sets ended_at to today',
  pg_temp.exec('service', $$
    UPDATE public.house_church_members
       SET ended_at = current_date
     WHERE house_church_id = '00000000-0000-4000-8000-000000000006'
       AND ended_at IS NULL
  $$),
  'rows=1');
SELECT pg_temp.expect('a same-day end drops the service-role row from member status',
  (SELECT (
      SELECT count(*) FROM public.missio_member_status
      WHERE contact_id = 'c4444444-4444-4444-4444-444444444444'
    )::text || '/' || (
      SELECT ended_at::text || '/' || created_by::text
      FROM public.house_church_members
      WHERE house_church_id = '00000000-0000-4000-8000-000000000006'
    )),
  '0/' || current_date::text || '/a4444444-4444-4444-4444-444444444444');
SELECT pg_temp.expect('ended row is gone from member status',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT count(*) FROM public.missio_member_status
      WHERE contact_id = 'c4444444-4444-4444-4444-444444444444'
    )::text
  $$),
  '0');
SELECT pg_temp.expect('house membership did not create or change org_people',
  (SELECT status || '/' || count(*)::text
     FROM public.org_people
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
    GROUP BY status),
  'visitor/1');
SELECT pg_temp.expect('house membership did not change Fixture One org_people',
  (SELECT status || '/' || count(*)::text
     FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
    GROUP BY status),
  'active/1');

-- ── Import review ─────────────────────────────────────────
SELECT pg_temp.expect('service role can stage two names from one sheet line',
  pg_temp.exec('service', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role, kind)
    SELECT id, v.line, v.raw_name, 4, 'member', 'person'
    FROM public.organisations
    CROSS JOIN (VALUES
      (10, 'Ada Fixture'),
      (10, 'Ben Fixture')
    ) AS v(line, raw_name)
    WHERE slug = 'missio'
  $$),
  'rows=2');
SELECT pg_temp.expect('same line and same name cannot be staged twice',
  pg_temp.exec('service', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role)
    SELECT id, 10, 'Ada Fixture', 4, 'member'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 23505');
SELECT pg_temp.expect('source_line is required',
  pg_temp.exec('service', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role)
    SELECT id, NULL, 'No Line', 4, 'member'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 23502');
SELECT pg_temp.expect('pastor can read the staged rows',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           string_agg(raw_name, ',' ORDER BY raw_name)
    FROM public.missio_import_review
  $$),
  '2/Ada Fixture,Ben Fixture');
SELECT pg_temp.expect('pastor cannot resolve to a contact outside candidates and org_people',
  pg_temp.fail('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'matched',
           resolved_contact_id = 'c5555555-5555-5555-5555-555555555555'
     WHERE raw_name = 'Ada Fixture'
  $$),
  '23503 missio_resolve_not_allowed');
SELECT pg_temp.expect('service role cannot resolve to a contact outside candidates and org_people',
  pg_temp.fail('service', $$
    UPDATE public.missio_import_review
       SET resolved_contact_id = 'c5555555-5555-5555-5555-555555555555',
           resolved_by = 'a4444444-4444-4444-4444-444444444444'
     WHERE raw_name = 'Ada Fixture'
  $$),
  '23503 missio_resolve_not_allowed');
SELECT pg_temp.expect('service role insert of a disallowed resolve is rejected',
  pg_temp.fail('service', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role, resolved_contact_id, resolved_by)
    SELECT id, 12, 'Bad Resolve', 4, 'member',
           'c5555555-5555-5555-5555-555555555555',
           'a4444444-4444-4444-4444-444444444444'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  '23503 missio_resolve_not_allowed');
SELECT pg_temp.expect('that rejected resolve did not stick',
  (SELECT status || '/' || (resolved_contact_id IS NULL)::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'),
  'pending/true');
SELECT pg_temp.expect('service role can put a contact on the candidate list',
  pg_temp.exec('service', $$
    UPDATE public.missio_import_review
       SET candidate_contact_ids = ARRAY['c5555555-5555-5555-5555-555555555555']::uuid[]
     WHERE raw_name = 'Ben Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor can resolve to a listed candidate who is not in org_people',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'matched',
           resolved_contact_id = 'c5555555-5555-5555-5555-555555555555',
           resolved_by = 'a4444444-4444-4444-4444-444444444444'
     WHERE raw_name = 'Ben Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('candidate resolve stuck and resolved_by was pinned',
  (SELECT status || '/' || resolved_contact_id::text || '/' || resolved_by::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ben Fixture'),
  'matched/c5555555-5555-5555-5555-555555555555/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('matched status requires a contact',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'matched'
     WHERE raw_name = 'Ada Fixture'
  $$),
  'err 23514');
SELECT pg_temp.expect('pastor can resolve a staged row',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'matched',
           resolved_contact_id = 'c2222222-2222-2222-2222-222222222222',
           notes = 'Same person',
           resolved_by = 'a1111111-1111-1111-1111-111111111111',
           resolved_at = now()
     WHERE raw_name = 'Ada Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('resolve stuck, and updated_at moved',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT status || '/' || resolved_contact_id::text || '/' || notes || '/' ||
           (resolved_by = 'a1111111-1111-1111-1111-111111111111')::text || '/' ||
           (resolved_at IS NOT NULL)::text || '/' ||
           (updated_at > created_at)::text
    FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'
  $$),
  'matched/c2222222-2222-2222-2222-222222222222/Same person/true/true/true');
SELECT pg_temp.expect('pastor can send a resolved row back to pending',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'pending',
           resolved_by = 'a1111111-1111-1111-1111-111111111111',
           resolved_at = now()
     WHERE raw_name = 'Ada Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('pending clears resolved_by and resolved_at',
  (SELECT status || '/' || (resolved_by IS NULL)::text || '/' || (resolved_at IS NULL)::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'),
  'pending/true/true');
SELECT pg_temp.expect('pastor transition to new pins the resolver',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET status = 'new',
           resolved_by = 'a4444444-4444-4444-4444-444444444444'
     WHERE raw_name = 'Ada Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('new status kept the pin and stamped resolved_at',
  (SELECT status || '/' || resolved_by::text || '/' || (resolved_at IS NOT NULL)::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'),
  'new/a1111111-1111-1111-1111-111111111111/true');
SELECT pg_temp.expect('service role skipped keeps the supplied resolver',
  pg_temp.exec('service', $$
    UPDATE public.missio_import_review
       SET status = 'skipped',
           resolved_by = 'a4444444-4444-4444-4444-444444444444'
     WHERE raw_name = 'Ada Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('skipped kept resolved_by and stamped resolved_at',
  (SELECT status || '/' || resolved_by::text || '/' || (resolved_at::date = current_date)::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'),
  'skipped/a4444444-4444-4444-4444-444444444444/true');
SELECT pg_temp.expect('service role pending clears the resolver too',
  pg_temp.exec('service', $$
    UPDATE public.missio_import_review
       SET status = 'pending',
           resolved_by = 'a4444444-4444-4444-4444-444444444444',
           resolved_at = now()
     WHERE raw_name = 'Ada Fixture'
  $$),
  'rows=1');
SELECT pg_temp.expect('service role pending left both resolver fields null',
  (SELECT status || '/' || (resolved_by IS NULL)::text || '/' || (resolved_at IS NULL)::text
     FROM public.missio_import_review
    WHERE raw_name = 'Ada Fixture'),
  'pending/true/true');
SELECT pg_temp.expect('pastor cannot rewrite the sheet name',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET raw_name = 'Changed'
     WHERE raw_name = 'Ben Fixture'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot rewrite the house number',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_import_review
       SET house_number = 9
     WHERE raw_name = 'Ben Fixture'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot insert import review',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role)
    SELECT id, 11, 'New Fixture', 4, 'member'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
GRANT INSERT ON public.missio_import_review TO authenticated;
SELECT pg_temp.expect('pastor cannot insert import review even with a grant',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_import_review
      (org_id, source_line, raw_name, house_number, role)
    SELECT id, 11, 'New Fixture', 4, 'member'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
REVOKE INSERT ON public.missio_import_review FROM authenticated;
SELECT pg_temp.expect('pastor cannot delete import review',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_import_review WHERE raw_name = 'Ben Fixture'
  $$),
  'err 42501');
GRANT DELETE ON public.missio_import_review TO authenticated;
SELECT pg_temp.expect('pastor cannot delete import review even with a grant',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_import_review WHERE raw_name = 'Ben Fixture'
  $$),
  'rows=0');
REVOKE DELETE ON public.missio_import_review FROM authenticated;
SELECT pg_temp.expect('the unresolved row is still staged',
  (SELECT count(*)::text FROM public.missio_import_review WHERE raw_name = 'Ben Fixture'),
  '1');
SELECT pg_temp.expect('HARD WALL admin still sees 0 import rows',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_import_review$$),
  '0');
SELECT pg_temp.expect('Missio org admin still sees 0 import rows',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_import_review$$),
  '0');

-- ── Shape ─────────────────────────────────────────────────
SELECT pg_temp.expect('member status columns carry no names',
  (SELECT string_agg(attname, ',' ORDER BY attnum)
     FROM pg_attribute
    WHERE attrelid = 'public.missio_member_status'::regclass
      AND attnum > 0 AND NOT attisdropped),
  'org_id,contact_id,active_house_count,house_numbers,roles,is_member');
SELECT pg_temp.expect('member status is security_invoker',
  (SELECT ('security_invoker=true' = ANY (reloptions))::text
     FROM pg_class
    WHERE oid = 'public.missio_member_status'::regclass),
  'true');
SELECT pg_temp.expect('no is_admin, has_role, or contacts permission in these policies',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('house_churches', 'house_church_members', 'missio_import_review')
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
          || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
        ~ '(is_admin|has_any_role|has_permission|contacts\.(view|read|write|edit|create|delete))\s*\('
        OR coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           ~ '[^a-z_]has_role\s*\('
      )),
  '0');
SELECT pg_temp.expect('every house policy calls has_org_role for the missio pastor',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname IN ('house_churches', 'house_church_members', 'missio_import_review')
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
          || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
      ) LIKE '%has_org_role%'),
  '8');
SELECT pg_temp.expect('import review has no insert or delete policy',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'missio_import_review'
      AND pol.polcmd IN ('a', 'd')),
  '0');
SELECT pg_temp.expect('anon has no privileges on the tables or the view',
  (SELECT (
      has_table_privilege('anon', 'public.house_churches', 'SELECT')
      OR has_table_privilege('anon', 'public.house_church_members', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_import_review', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_member_status', 'SELECT')
    )::text),
  'false');
SELECT pg_temp.expect('authenticated resolves import review and cannot rewrite the payload',
  (SELECT (
      has_column_privilege('authenticated', 'public.missio_import_review', 'status', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.missio_import_review', 'resolved_contact_id', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.missio_import_review', 'notes', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.missio_import_review', 'resolved_by', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.missio_import_review', 'resolved_at', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.missio_import_review', 'raw_name', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.missio_import_review', 'source_line', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.missio_import_review', 'house_number', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.missio_import_review', 'org_id', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.missio_import_review', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.missio_import_review', 'DELETE')
    )::text),
  'true');

SELECT pg_temp.expect('service role can remove the org_people row',
  pg_temp.exec('service', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
  $$),
  'rows=1');
SELECT pg_temp.expect('an open membership can still be ended after org_people is gone',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.house_church_members
       SET ended_at = current_date
     WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
       AND house_church_id = '00000000-0000-4000-8000-000000000002'
       AND ended_at IS NULL
  $$),
  'rows=1');

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
  RAISE NOTICE 'missio_house_churches_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_house_churches_rls: % checks failed', n_fail;
  END IF;
END $$;
