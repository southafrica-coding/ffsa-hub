-- Disposable privacy check for migration 354. Not a migration.
-- Stubs the FFSA tables and helpers 329 calls, applies 329, 331,
-- 337, 338, 343 and 354 (354 twice), then reads and writes Care
-- requests as a pastor, a house leader, a co-leader, a house member,
-- another house's leader, a coach, a member with no Missio role, a
-- member whose membership ended, and anon.
--
--   dropdb --if-exists missio_care_privacy && createdb missio_care_privacy
--   psql -v ON_ERROR_STOP=1 -d missio_care_privacy -f supabase/tests/missio_care_privacy_rls.sql
--
-- Never point this at a shared or hosted database. Phone numbers are
-- made up.

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
\ir ../migrations/331_missio_house_churches.sql
\ir ../migrations/337_missio_coaches.sql
\ir ../migrations/338_missio_roles.sql
\ir ../migrations/343_missio_care.sql
\ir ../migrations/354_missio_care_leader_visibility.sql
\ir ../migrations/354_missio_care_leader_visibility.sql

UPDATE public.house_churches hc
   SET id = ('00000000-0000-4000-8000-' || lpad(hc.number::text, 12, '0'))::uuid
  FROM public.organisations o
 WHERE o.id = hc.org_id
   AND o.slug = 'missio';

-- ── Fixtures ──────────────────────────────────────────────
-- pastor    Missio pastor. In no house.
-- leader    house_church_leader, leads house 1.
-- coleader  house_church_leader, co-leads house 1.
-- member    team_leader (a Missio role), member of house 1.
-- leader2   house_church_leader, leads house 2.
-- coach     coach of house 1. Not a member, not a leader.
-- norole    member of house 1 with no Missio role.
-- ended     team_leader whose house 1 membership has ended.

INSERT INTO public.users (id, email, contact_id) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor@test',   'c1111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'leader@test',   'c2222222-2222-2222-2222-222222222222'),
  ('a3333333-3333-3333-3333-333333333333', 'coleader@test', 'c3333333-3333-3333-3333-333333333333'),
  ('a6666666-6666-6666-6666-666666666666', 'member@test',   'c6666666-6666-6666-6666-666666666666'),
  ('a7777777-7777-7777-7777-777777777777', 'leader2@test',  'c7777777-7777-7777-7777-777777777777'),
  ('a8888888-8888-8888-8888-888888888888', 'coach@test',    'c8888888-8888-8888-8888-888888888888'),
  ('a9999999-9999-9999-9999-999999999999', 'norole@test',   'c9999999-9999-9999-9999-999999999999'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ended@test',    'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.contacts (id, first_name, last_name)
SELECT u.contact_id, 'Fixture', split_part(u.email, '@', 1)
FROM public.users u;

INSERT INTO public.org_people (org_id, contact_id, campus, status)
SELECT o.id, u.contact_id, 'potch', 'active'
FROM public.users u
CROSS JOIN public.organisations o
WHERE o.slug = 'missio';

INSERT INTO public.org_staff_roles (user_id, org_id, role)
SELECT v.uid::uuid, o.id, v.role
FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor'),
  ('a2222222-2222-2222-2222-222222222222', 'house_church_leader'),
  ('a3333333-3333-3333-3333-333333333333', 'house_church_leader'),
  ('a6666666-6666-6666-6666-666666666666', 'team_leader'),
  ('a7777777-7777-7777-7777-777777777777', 'house_church_leader'),
  ('a8888888-8888-8888-8888-888888888888', 'coach'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'team_leader')
) AS v(uid, role)
JOIN public.organisations o ON o.slug = 'missio';

INSERT INTO public.house_church_members (house_church_id, contact_id, role, started_at, ended_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'leader',    current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000001', 'c3333333-3333-3333-3333-333333333333', 'co_leader', current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000001', 'c6666666-6666-6666-6666-666666666666', 'member',    current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000002', 'c7777777-7777-7777-7777-777777777777', 'leader',    current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000001', 'c9999999-9999-9999-9999-999999999999', 'member',    current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000001', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member',    current_date - 30, current_date - 1);

INSERT INTO public.missio_coach_assignments (house_church_id, coach_contact_id)
VALUES ('00000000-0000-4000-8000-000000000001', 'c8888888-8888-8888-8888-888888888888');

-- r1 pastors / house 1      r2 pastors_leaders / house 1   r3 house / house 1
-- r4 house / house 2        r5 pastors_leaders / no house  r6 house / no house
-- r7 pastors_leaders / house 2
INSERT INTO public.missio_care_requests (id, org_id, source, house_church_id, name, phone, needs, body, privacy)
SELECT v.id::uuid, o.id, 'manual', v.house::uuid, v.name, v.phone, ARRAY['prayer', 'talk']::text[], 'Fixture body', v.privacy
FROM (VALUES
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'One',   '000 000 0001', 'pastors'),
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Two',   '000 000 0002', 'pastors_leaders'),
  ('e0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Three', '000 000 0003', 'house'),
  ('e0000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', 'Four',  '000 000 0004', 'house'),
  ('e0000000-0000-4000-8000-000000000005', NULL,                                   'Five',  '000 000 0005', 'pastors_leaders'),
  ('e0000000-0000-4000-8000-000000000006', NULL,                                   'Six',   '000 000 0006', 'house'),
  ('e0000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000002', 'Seven', NULL,           'pastors_leaders')
) AS v(id, house, name, phone, privacy)
CROSS JOIN public.organisations o
WHERE o.slug = 'missio';

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

-- Which requests (by name) a user reads.
CREATE FUNCTION pg_temp.sees(who text)
RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(pg_temp.scalar(who, $q$
    SELECT string_agg(name, ',' ORDER BY id) FROM public.missio_care_requests
  $q$), '-');
$$;

-- Which phones a user is handed.
CREATE FUNCTION pg_temp.phones(who text)
RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(pg_temp.scalar(who, $q$
    SELECT string_agg(phone, ',' ORDER BY id) FROM public.missio_care_phones(ARRAY(
      SELECT ('e0000000-0000-4000-8000-00000000000' || g)::uuid FROM generate_series(1, 7) g
    ))
  $q$), '-');
$$;

\set pastor   '''a1111111-1111-1111-1111-111111111111'''
\set leader   '''a2222222-2222-2222-2222-222222222222'''
\set coleader '''a3333333-3333-3333-3333-333333333333'''
\set member   '''a6666666-6666-6666-6666-666666666666'''
\set leader2  '''a7777777-7777-7777-7777-777777777777'''
\set coach    '''a8888888-8888-8888-8888-888888888888'''
\set norole   '''a9999999-9999-9999-9999-999999999999'''
\set ended    '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''

-- ── Reading ───────────────────────────────────────────────
SELECT pg_temp.expect('pastor sees every request', pg_temp.sees(:pastor), 'One,Two,Three,Four,Five,Six,Seven');
SELECT pg_temp.expect('leader sees pastors_leaders and house for their house only', pg_temp.sees(:leader), 'Two,Three');
SELECT pg_temp.expect('co-leader sees the same as the leader', pg_temp.sees(:coleader), 'Two,Three');
SELECT pg_temp.expect('member sees only house privacy for their house', pg_temp.sees(:member), 'Three');
SELECT pg_temp.expect('another house''s leader sees only their own house', pg_temp.sees(:leader2), 'Four,Seven');
SELECT pg_temp.expect('a coach is not a leader here', pg_temp.sees(:coach), '-');
SELECT pg_temp.expect('a member with no Missio role sees nothing', pg_temp.sees(:norole), '-');
SELECT pg_temp.expect('an ended membership sees nothing', pg_temp.sees(:ended), '-');
SELECT pg_temp.expect('anon cannot read', pg_temp.sees('anon'), 'err 42501');

-- ── Phones ────────────────────────────────────────────────
SELECT pg_temp.expect('nobody reads the phone column directly (member)',
  pg_temp.scalar(:member, $$SELECT phone FROM public.missio_care_requests LIMIT 1$$), 'err 42501');
SELECT pg_temp.expect('nobody reads the phone column directly (pastor)',
  pg_temp.scalar(:pastor, $$SELECT phone FROM public.missio_care_requests LIMIT 1$$), 'err 42501');
SELECT pg_temp.expect('nor select *',
  pg_temp.scalar(:leader, $$SELECT count(*) FROM (SELECT * FROM public.missio_care_requests) t$$), 'err 42501');
SELECT pg_temp.expect('pastor gets every phone', pg_temp.phones(:pastor),
  '000 000 0001,000 000 0002,000 000 0003,000 000 0004,000 000 0005,000 000 0006');
SELECT pg_temp.expect('leader gets their house''s shared phones', pg_temp.phones(:leader), '000 000 0002,000 000 0003');
SELECT pg_temp.expect('member gets no phone, even on a house request', pg_temp.phones(:member), '-');
SELECT pg_temp.expect('coach gets no phone', pg_temp.phones(:coach), '-');
SELECT pg_temp.expect('anon cannot call the phone function', pg_temp.phones('anon'), 'err 42501');

-- ── Writing ───────────────────────────────────────────────
SELECT pg_temp.expect('member cannot take a house request',
  pg_temp.exec(:member, $$UPDATE public.missio_care_requests SET status = 'on_it', taken_by = auth.uid(), taken_at = now() WHERE id = 'e0000000-0000-4000-8000-000000000003'$$),
  'rows=0');
SELECT pg_temp.expect('coach cannot take a request',
  pg_temp.exec(:coach, $$UPDATE public.missio_care_requests SET status = 'on_it' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'rows=0');
SELECT pg_temp.expect('leader cannot touch a pastors-only request',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'on_it' WHERE id = 'e0000000-0000-4000-8000-000000000001'$$),
  'rows=0');
SELECT pg_temp.expect('leader cannot touch another house',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'on_it' WHERE id IN ('e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000007')$$),
  'rows=0');
SELECT pg_temp.expect('leader cannot touch a request with no house',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'on_it' WHERE id = 'e0000000-0000-4000-8000-000000000005'$$),
  'rows=0');
SELECT pg_temp.expect('leader takes a house request (returning id, as the API does)',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'on_it', taken_by = auth.uid(), taken_at = now() WHERE id = 'e0000000-0000-4000-8000-000000000003' AND status = 'new' RETURNING id$$),
  'rows=1');
SELECT pg_temp.expect('leader cannot hand a request to someone else',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'on_it', taken_by = 'a3333333-3333-3333-3333-333333333333' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'err 42501');
SELECT pg_temp.expect('leader cannot widen the privacy',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET privacy = 'house' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'err 42501');
SELECT pg_temp.expect('leader cannot move it to another house',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET house_church_id = '00000000-0000-4000-8000-000000000002' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'err 42501');
SELECT pg_temp.expect('leader cannot rewrite what was asked',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET body = 'changed' WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'err 42501');
SELECT pg_temp.expect('co-leader finishes a shared request',
  pg_temp.exec(:coleader, $$UPDATE public.missio_care_requests SET status = 'done', done_at = now(), taken_by = auth.uid(), taken_at = now() WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'rows=1');
SELECT pg_temp.expect('co-leader checks back in',
  pg_temp.exec(:coleader, $$UPDATE public.missio_care_requests SET checked_in_at = now() WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'rows=1');
SELECT pg_temp.expect('leader cannot reopen',
  pg_temp.exec(:leader, $$UPDATE public.missio_care_requests SET status = 'new', taken_by = NULL, taken_at = NULL, done_at = NULL WHERE id = 'e0000000-0000-4000-8000-000000000002'$$),
  'err 42501');
SELECT pg_temp.expect('pastor reopens',
  pg_temp.exec(:pastor, $$UPDATE public.missio_care_requests SET status = 'new', taken_by = NULL, taken_at = NULL, done_at = NULL, done_note = NULL WHERE id = 'e0000000-0000-4000-8000-000000000002' RETURNING id$$),
  'rows=1');
SELECT pg_temp.expect('pastor still moves any request',
  pg_temp.exec(:pastor, $$UPDATE public.missio_care_requests SET status = 'on_it', taken_by = auth.uid() WHERE id IN ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005')$$),
  'rows=2');
SELECT pg_temp.expect('the take stuck',
  (SELECT status || '/' || (taken_by = 'a2222222-2222-2222-2222-222222222222')::text FROM public.missio_care_requests WHERE id = 'e0000000-0000-4000-8000-000000000003'),
  'on_it/true');

SELECT pg_temp.expect('leader cannot log a request',
  pg_temp.exec(:leader, $$INSERT INTO public.missio_care_requests (org_id, source, needs, body, privacy, house_church_id)
    SELECT id, 'manual', ARRAY['prayer'], 'x', 'house', '00000000-0000-4000-8000-000000000001' FROM public.organisations WHERE slug = 'missio'$$),
  'err 42501');
SELECT pg_temp.expect('member cannot log a request',
  pg_temp.exec(:member, $$INSERT INTO public.missio_care_requests (org_id, source, needs, body)
    SELECT id, 'manual', ARRAY['prayer'], 'x' FROM public.organisations WHERE slug = 'missio'$$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot write as the care form',
  pg_temp.exec(:pastor, $$INSERT INTO public.missio_care_requests (org_id, source, needs, body)
    SELECT id, 'care_form', ARRAY['prayer'], 'x' FROM public.organisations WHERE slug = 'missio'$$),
  'err 42501');
SELECT pg_temp.expect('pastor logs by hand, phone included',
  pg_temp.exec(:pastor, $$INSERT INTO public.missio_care_requests (org_id, source, needs, body, phone)
    SELECT id, 'manual', ARRAY['talk'], 'x', '000 000 0009' FROM public.organisations WHERE slug = 'missio'$$),
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
  RAISE NOTICE 'missio_care_privacy_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_care_privacy_rls: % checks failed', n_fail;
  END IF;
END $$;
