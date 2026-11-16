-- Disposable RLS check for migration 328. Not a migration.
-- Stubs the parent rows and the helpers the new policy calls, installs
-- the schools-manager reference policies from 223 (has_schools_access
-- only), proves an assigned program_staff reviewer sees nothing, then
-- applies 328 (twice — it must be re-runnable).
--
-- application_responses is left without RLS on purpose. Migration 304
-- already covers "assigned staff can read their application". This file
-- tests the reference_requests policy on its own: if the parent hid the
-- other application, a missing assignment check would still look green.
--
--   dropdb --if-exists reference_assigned_staff_rls && createdb reference_assigned_staff_rls
--   psql -v ON_ERROR_STOP=1 -d reference_assigned_staff_rls -f supabase/tests/reference_requests_assigned_staff_rls.sql
--
-- People, all on one program, none of them schools.manage / admin /
-- program_leader:
--   reviewer    program_staff, assigned_staff_id on app Mine (2 refs)
--   unassigned  program_staff, assigned to neither application
--   other       assigned_staff_id on app Other (2 refs), not program_staff

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
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
  SELECT public.has_permission(required_permission);
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.programs (id uuid PRIMARY KEY);
CREATE TABLE public.program_leaders (
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid NOT NULL REFERENCES public.users(id)
);
CREATE TABLE public.program_staff (
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  UNIQUE (program_id, user_id)
);

-- 145. SECURITY DEFINER so the check can see program_leaders under RLS.
CREATE OR REPLACE FUNCTION public.is_program_leader(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.program_leaders
    WHERE program_id = target_program_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission_for('schools.manage', target_program_id)
      OR public.is_program_leader(target_program_id);
$$;

CREATE OR REPLACE FUNCTION public.is_program_staff(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.program_staff
    WHERE program_id = target_program_id AND user_id = auth.uid()
  );
$$;

-- 304's body. The extra schools.* arms are false in this fixture
-- (test.perms is empty). Staff qualify through is_program_staff only.
CREATE OR REPLACE FUNCTION public.can_access_assigned_school_record(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_program_staff(target_program_id)
      OR public.has_schools_access(target_program_id)
      OR public.has_permission_for('schools.view_applications', target_program_id)
      OR public.has_permission_for('schools.approve_applications', target_program_id)
      OR public.has_permission_for('schools.manage_enrollments', target_program_id)
      OR public.has_permission_for('schools.manage_attendance', target_program_id)
      OR public.has_permission_for('schools.assignable_as_contact', target_program_id);
$$;

CREATE OR REPLACE FUNCTION public.program_applications_expired(pid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.can_access_expired_applications()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;

-- 223. The fixture school is not expired, so this is normal_access.
CREATE OR REPLACE FUNCTION public.application_gate(pid uuid, normal_access boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.program_applications_expired(pid)
      THEN public.can_access_expired_applications()
    ELSE coalesce(normal_access, false)
  END;
$$;

CREATE TABLE public.application_responses (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  user_id uuid REFERENCES public.users(id),
  assigned_staff_id uuid REFERENCES public.users(id)
);
CREATE TABLE public.reference_slots (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES public.programs(id)
);
CREATE TABLE public.reference_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.application_responses(id),
  slot_id uuid NOT NULL REFERENCES public.reference_slots(id),
  referee_name text NOT NULL,
  referee_email text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  UNIQUE (application_id, slot_id)
);

-- 223, unchanged by 328. Schools managers only. Created after
-- application_responses: a SQL function is checked against the catalog
-- at CREATE time.
CREATE OR REPLACE FUNCTION public.reference_request_access(app_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT public.application_gate(ar.program_id, public.has_schools_access(ar.program_id))
    FROM public.application_responses ar
    WHERE ar.id = app_id
  ), false);
$$;

ALTER TABLE public.reference_requests ENABLE ROW LEVEL SECURITY;

-- The policies 328 must leave in place. has_schools_access only.
CREATE POLICY "Schools managers can read all reference requests"
  ON public.reference_requests FOR SELECT
  USING (public.reference_request_access(application_id));

CREATE POLICY "Schools managers can insert reference requests"
  ON public.reference_requests FOR INSERT
  WITH CHECK (public.reference_request_access(application_id));

CREATE POLICY "Schools managers can update reference requests"
  ON public.reference_requests FOR UPDATE
  USING (public.reference_request_access(application_id))
  WITH CHECK (public.reference_request_access(application_id));

GRANT EXECUTE ON FUNCTION public.is_program_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_schools_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_assigned_school_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.application_gate(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reference_request_access(uuid) TO authenticated;
GRANT SELECT ON public.application_responses TO authenticated;
GRANT SELECT, UPDATE ON public.reference_requests TO authenticated;

-- Seed. Nobody holds schools.manage, admin, or a program_leaders row.
INSERT INTO public.users (id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
INSERT INTO public.programs (id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
INSERT INTO public.program_staff (program_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
INSERT INTO public.application_responses (id, program_id, assigned_staff_id) VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
INSERT INTO public.reference_slots (id, program_id) VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
INSERT INTO public.reference_requests (id, application_id, slot_id, referee_name, referee_email) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'Referee one', 'referee-one@example.test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'Referee two', 'referee-two@example.test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'Referee three', 'referee-three@example.test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'Referee four', 'referee-four@example.test');

CREATE TEMP TABLE t328_reference_request_access (def text);
INSERT INTO t328_reference_request_access
SELECT pg_get_functiondef('public.reference_request_access(uuid)'::regprocedure);

-- ── Before 328: the reviewer is assigned and is program_staff, and
-- still sees no references. That is the bug. ──
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', false);
SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);

DO $$
BEGIN
  IF public.has_schools_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'fixture reviewer has schools access';
  END IF;
  IF NOT public.can_access_assigned_school_record('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'fixture reviewer is not program staff of the school';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests) <> 0 THEN
    RAISE EXCEPTION 'reviewer saw references before 328';
  END IF;
END $$;

RESET ROLE;

\ir ../migrations/328_reference_requests_assigned_staff_read.sql
\ir ../migrations/328_reference_requests_assigned_staff_read.sql

DO $$
BEGIN
  IF (SELECT def FROM t328_reference_request_access)
     IS DISTINCT FROM pg_get_functiondef('public.reference_request_access(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '328 changed reference_request_access()';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'reference_requests'
       AND p.polname = 'Assigned staff can read their applications'' references'
       AND p.polcmd = 'r'
       AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
  ) THEN
    RAISE EXCEPTION '328 did not install a SELECT policy for authenticated';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'reference_requests'
       AND p.polname = 'Assigned staff can read their applications'' references'
       AND p.polcmd <> 'r'
  ) THEN
    RAISE EXCEPTION '328 added a write policy';
  END IF;
END $$;

-- ── Assigned reviewer ──
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', false);
SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.reference_requests
       WHERE application_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1') <> 2 THEN
    RAISE EXCEPTION 'assigned reviewer should see exactly 2 references on their application';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests
       WHERE application_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc2') <> 0 THEN
    RAISE EXCEPTION 'assigned reviewer saw references on an application that is not theirs';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests) <> 2 THEN
    RAISE EXCEPTION 'assigned reviewer saw a reference outside their application';
  END IF;

  UPDATE public.reference_requests
     SET status = 'submitted'
   WHERE application_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  IF FOUND THEN
    RAISE EXCEPTION 'assigned reviewer updated a reference';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests WHERE status <> 'pending') <> 0 THEN
    RAISE EXCEPTION 'a reference status changed';
  END IF;
END $$;

-- ── Program staff who is not the assigned reviewer ──
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', false);

DO $$
BEGIN
  IF public.has_schools_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'fixture unassigned staff has schools access';
  END IF;
  IF NOT public.is_program_staff('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'fixture unassigned user is not program staff';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests) <> 0 THEN
    RAISE EXCEPTION 'unassigned program staff saw a reference';
  END IF;
END $$;

-- Assigned on the other application, but not program_staff and with no
-- schools grant. can_access_assigned_school_record is false, so the new
-- policy must not open those two references.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', false);

DO $$
BEGIN
  IF public.is_program_staff('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')
     OR public.has_schools_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'fixture other assignee has a school grant';
  END IF;
  IF (SELECT count(*) FROM public.reference_requests) <> 0 THEN
    RAISE EXCEPTION 'assignee without a school grant saw a reference';
  END IF;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.reference_requests WHERE status <> 'pending') <> 0 THEN
    RAISE EXCEPTION 'a reference was updated';
  END IF;
END $$;

\echo 'reference_requests assigned staff RLS checks passed'
