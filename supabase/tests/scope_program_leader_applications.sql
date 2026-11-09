-- Disposable check for migration 312 (program_leader scoping in
-- can_manage_program_applications). Not a migration.
--
-- Unlike the stub-based tests, this runs against a database that already
-- has the real schema (local `supabase db reset`, or a throwaway copy with
-- 304–309, 307 and 312 applied). Everything happens inside one transaction
-- that is rolled back. Never point this at a shared or remote database.
--
--   psql -v ON_ERROR_STOP=1 -d <throwaway> -f supabase/tests/scope_program_leader_applications.sql
--
-- People (program A, program B):
--   plA       program_leader role scoped to A, no program_leaders row
--   plU       program_leader role with no scope
--   plT       program_leader role scoped to a team (not a program)
--   ledB      named leader of B (program_leaders row), no role
--   adm       admin role (unscoped)
--   apprA     schools.approve_applications scoped to A
--   enrG      schools.manage_enrollments unscoped
--   stfA      program_staff of A only
--   nobody    signed in, no grants
-- Every person gets PASS cases (true where they should be) and FAIL cases
-- (false where they must not reach). Any mismatch raises at the end.

\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

CREATE TEMP TABLE t312 (label text, got boolean, want boolean);

DO $$
DECLARE
  pa uuid := gen_random_uuid();
  pb uuid := gen_random_uuid();
  ppl uuid; padm uuid;
  k_manage uuid; k_appr uuid; k_enr uuid;
  u record;
  people text[] := ARRAY['plA','plU','plT','ledB','adm','apprA','enrG','stfA','nobody'];
  ids jsonb := '{}'::jsonb;
  who text;
BEGIN
  FOREACH who IN ARRAY people LOOP
    ids := ids || jsonb_build_object(who, gen_random_uuid());
    INSERT INTO auth.users (id, email) VALUES ((ids->>who)::uuid, who || '@t312.test');
    INSERT INTO public.users (id, email, first_name, last_name) VALUES ((ids->>who)::uuid, who || '@t312.test', who, 'T312');
  END LOOP;
  INSERT INTO public.programs (id, name, code, created_by) VALUES
    (pa, 't312 A', 'T312A' || left(pa::text, 4), (ids->>'adm')::uuid),
    (pb, 't312 B', 'T312B' || left(pb::text, 4), (ids->>'adm')::uuid);

  INSERT INTO public.roles (name, display_name) VALUES ('program_leader', 'Program Leader') ON CONFLICT (name) DO NOTHING;
  INSERT INTO public.roles (name, display_name) VALUES ('admin', 'Admin') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO ppl FROM public.roles WHERE name = 'program_leader';
  SELECT id INTO padm FROM public.roles WHERE name = 'admin';
  INSERT INTO public.permissions (module, key, display_name) VALUES
    ('schools', 'schools.manage', 'Manage schools'),
    ('schools', 'schools.approve_applications', 'Approve applications'),
    ('schools', 'schools.manage_enrollments', 'Manage enrolments')
  ON CONFLICT (key) DO NOTHING;
  SELECT id INTO k_manage FROM public.permissions WHERE key = 'schools.manage';
  SELECT id INTO k_appr FROM public.permissions WHERE key = 'schools.approve_applications';
  SELECT id INTO k_enr FROM public.permissions WHERE key = 'schools.manage_enrollments';
  -- Phase 1 isolates the 312 branch: the program_leader role carries no
  -- permission bundle in this transaction.
  DELETE FROM public.role_permissions WHERE role_id = ppl;

  INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id) VALUES
    ((ids->>'plA')::uuid, ppl, 'program', pa),
    ((ids->>'plU')::uuid, ppl, NULL, NULL),
    ((ids->>'plT')::uuid, ppl, 'team', gen_random_uuid()),
    ((ids->>'adm')::uuid, padm, NULL, NULL);
  INSERT INTO public.program_leaders (program_id, user_id) VALUES (pb, (ids->>'ledB')::uuid);
  INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id) VALUES
    ((ids->>'apprA')::uuid, k_appr, 'program', pa),
    ((ids->>'enrG')::uuid, k_enr, NULL, NULL);
  INSERT INTO public.program_staff (program_id, user_id) VALUES (pa, (ids->>'stfA')::uuid);

  PERFORM set_config('t312.pa', pa::text, true);
  PERFORM set_config('t312.pb', pb::text, true);
  PERFORM set_config('t312.ids', ids::text, true);
  PERFORM set_config('t312.ppl', ppl::text, true);
  PERFORM set_config('t312.kmanage', k_manage::text, true);
END $$;

-- Evaluate can_manage_program_applications and lms_can_edit for one person.
CREATE FUNCTION pg_temp.as_user(who text, prog text) RETURNS TABLE (cmpa boolean, lms boolean)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t312.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
  RETURN QUERY SELECT public.can_manage_program_applications(current_setting('t312.' || prog)::uuid),
                      public.lms_can_edit(current_setting('t312.' || prog)::uuid);
END $$;

CREATE FUNCTION pg_temp.expect(phase text, who text, want_a boolean, want_b boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE ra record; rb record;
BEGIN
  SELECT * INTO ra FROM pg_temp.as_user(who, 'pa');
  SELECT * INTO rb FROM pg_temp.as_user(who, 'pb');
  INSERT INTO t312 VALUES
    (phase || ' ' || who || ' cmpa(A)', ra.cmpa, want_a),
    (phase || ' ' || who || ' cmpa(B)', rb.cmpa, want_b),
    (phase || ' ' || who || ' lms_can_edit(A)', ra.lms, want_a),
    (phase || ' ' || who || ' lms_can_edit(B)', rb.lms, want_b);
END $$;

-- ── Phase 1: role without its bundle (tests the 312 branch alone) ──
SELECT pg_temp.expect('p1', 'plA',    true,  false);  -- scoped leader: A only (no program_leaders row)
SELECT pg_temp.expect('p1', 'plU',    true,  true);   -- unscoped role: every program
SELECT pg_temp.expect('p1', 'plT',    false, false);  -- team-scoped role: no program
SELECT pg_temp.expect('p1', 'ledB',   false, true);   -- named leader of B (has_schools_access)
SELECT pg_temp.expect('p1', 'adm',    true,  true);   -- admin
SELECT pg_temp.expect('p1', 'apprA',  true,  false);  -- approve_applications scoped to A
SELECT pg_temp.expect('p1', 'enrG',   true,  true);   -- manage_enrollments unscoped
SELECT pg_temp.expect('p1', 'stfA',   false, false);  -- program staff are not managers
SELECT pg_temp.expect('p1', 'nobody', false, false);

-- ── Phase 2: prod-like bundle (program_leader carries schools.manage) ──
INSERT INTO public.role_permissions (role_id, permission_id)
VALUES (current_setting('t312.ppl')::uuid, current_setting('t312.kmanage')::uuid);
SELECT pg_temp.expect('p2', 'plA',  true,  false);
SELECT pg_temp.expect('p2', 'plU',  true,  true);
SELECT pg_temp.expect('p2', 'plT',  false, false);

-- ── No auth.uid() (signed-in token without sub) ──
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
INSERT INTO t312 SELECT 'no sub cmpa(A)', public.can_manage_program_applications(current_setting('t312.pa')::uuid), false;

-- ── Grants and definition ──
INSERT INTO t312 VALUES
  ('anon cannot EXECUTE', has_function_privilege('anon', 'public.can_manage_program_applications(uuid)', 'EXECUTE'), false),
  ('PUBLIC has no EXECUTE', EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.can_manage_program_applications(uuid)'::regprocedure AND a.grantee = 0), false),
  ('authenticated can EXECUTE', has_function_privilege('authenticated', 'public.can_manage_program_applications(uuid)', 'EXECUTE'), true),
  ('service_role can EXECUTE', has_function_privilege('service_role', 'public.can_manage_program_applications(uuid)', 'EXECUTE'), true),
  ('still SECURITY DEFINER', (SELECT prosecdef FROM pg_proc WHERE oid = 'public.can_manage_program_applications(uuid)'::regprocedure), true),
  ('still STABLE', (SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.can_manage_program_applications(uuid)'::regprocedure), true),
  ('search_path pinned to empty', (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.can_manage_program_applications(uuid)'::regprocedure), true),
  ('signature unchanged', (SELECT pg_get_function_identity_arguments(oid) = 'target_program_id uuid' AND prorettype = 'boolean'::regtype FROM pg_proc WHERE oid = 'public.can_manage_program_applications(uuid)'::regprocedure), true);

-- anon calling it is refused outright.
DO $$
DECLARE st text;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.can_manage_program_applications(current_setting('t312.pa')::uuid);
  EXCEPTION WHEN OTHERS THEN st := SQLSTATE;
  END;
  RESET ROLE;
  INSERT INTO t312 VALUES ('anon call raises 42501', st = '42501', true);
END $$;

-- ── Report ──
DO $$
DECLARE n_all int; n_bad int; bad text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE got IS DISTINCT FROM want),
         string_agg(label || ' got=' || coalesce(got::text, 'null') || ' want=' || want, '; ') FILTER (WHERE got IS DISTINCT FROM want)
    INTO n_all, n_bad, bad FROM t312;
  RAISE NOTICE '312 test: % checks, % pass, % fail (% true-expected, % false-expected)',
    n_all, n_all - n_bad, n_bad,
    (SELECT count(*) FROM t312 WHERE want), (SELECT count(*) FROM t312 WHERE NOT want);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: %', bad;
  END IF;
END $$;

ROLLBACK;
SELECT '312_test: all checks passed' AS result;
