-- Disposable check for migration 313 (scope-aware schools deletes, active-only
-- permissions). Not a migration. Runs against a throwaway database with the
-- real schema (304–309, 307, 312, 313 applied). One transaction, rolled back.
-- Never point this at a shared or remote database.
--
--   psql -v ON_ERROR_STOP=1 -d <throwaway> -f supabase/tests/scope_aware_permissions.sql
--
-- People (program A, program B):
--   mA     schools.manage scoped to A (direct grant)
--   apA    schools.approve_applications scoped to A
--   enA    schools.manage_enrollments scoped to A
--   plA    program_leader role scoped to A (bundle carries schools.manage)
--   plT    program_leader role scoped to a team
--   evE    events.create scoped to an event, schools.manage scoped to an event
--   mG     schools.manage unscoped
--   adm    admin role
--   off    deactivated (is_active = false), schools.manage + approve unscoped
--   nobody signed in, no grants
--   anon   not signed in
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

CREATE TEMP TABLE t313 (n serial, label text, got text, want text);
GRANT ALL ON t313 TO PUBLIC;
GRANT USAGE ON SEQUENCE t313_n_seq TO PUBLIC;

DO $$
DECLARE
  pa uuid := gen_random_uuid();
  pb uuid := gen_random_uuid();
  ca uuid; cb uuid;
  ea uuid; eb uuid;
  ids jsonb := '{}'::jsonb;
  who text;
  r_pl uuid; r_adm uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['mA','apA','enA','plA','plT','evE','mG','adm','off','nobody','appl'] LOOP
    ids := ids || jsonb_build_object(who, gen_random_uuid());
    INSERT INTO auth.users (id, email) VALUES ((ids->>who)::uuid, who || '@t313.test');
    INSERT INTO public.users (id, email, first_name, last_name, is_active)
    VALUES ((ids->>who)::uuid, who || '@t313.test', who, 'T313', who <> 'off');
  END LOOP;
  INSERT INTO public.programs (id, name, code, created_by) VALUES
    (pa, 't313 A', 'T313A' || left(pa::text, 4), (ids->>'adm')::uuid),
    (pb, 't313 B', 'T313B' || left(pb::text, 4), (ids->>'adm')::uuid);

  INSERT INTO public.roles (name, display_name) VALUES ('program_leader', 'Program Leader'), ('admin', 'Admin')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO r_pl FROM public.roles WHERE name = 'program_leader';
  SELECT id INTO r_adm FROM public.roles WHERE name = 'admin';
  INSERT INTO public.permissions (module, key, display_name) VALUES
    ('schools', 'schools.manage', 'Manage schools'),
    ('schools', 'schools.approve_applications', 'Approve applications'),
    ('schools', 'schools.manage_enrollments', 'Manage enrolments'),
    ('events', 'events.create', 'Create events')
  ON CONFLICT (key) DO NOTHING;
  -- 125: program_leader bundle includes schools.manage
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r_pl, id FROM public.permissions WHERE key = 'schools.manage'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id) VALUES
    ((ids->>'plA')::uuid, r_pl, 'program', pa),
    ((ids->>'plT')::uuid, r_pl, 'team', gen_random_uuid()),
    ((ids->>'adm')::uuid, r_adm, NULL, NULL);
  INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
  SELECT (ids->>x.who)::uuid, p.id, x.st, x.sid
  FROM (VALUES
    ('mA',  'schools.manage',               'program', pa),
    ('apA', 'schools.approve_applications', 'program', pa),
    ('enA', 'schools.manage_enrollments',   'program', pa),
    ('evE', 'events.create',                'event',   gen_random_uuid()),
    ('evE', 'schools.manage',               'event',   gen_random_uuid()),
    ('mG',  'schools.manage',               NULL,      NULL::uuid),
    ('off', 'schools.manage',               NULL,      NULL::uuid),
    ('off', 'schools.approve_applications', NULL,      NULL::uuid)
  ) AS x(who, key, st, sid)
  JOIN public.permissions p ON p.key = x.key;

  INSERT INTO public.billing_courses (program_id, code, name) VALUES (pa, 'T313CA', 'Course A') RETURNING id INTO ca;
  INSERT INTO public.billing_courses (program_id, code, name) VALUES (pb, 'T313CB', 'Course B') RETURNING id INTO cb;
  INSERT INTO public.enrollments (user_id, program_id) VALUES ((ids->>'appl')::uuid, pa) RETURNING id INTO ea;
  INSERT INTO public.enrollments (user_id, program_id) VALUES ((ids->>'appl')::uuid, pb) RETURNING id INTO eb;

  PERFORM set_config('t313.pa', pa::text, false);
  PERFORM set_config('t313.pb', pb::text, false);
  PERFORM set_config('t313.ca', ca::text, false);
  PERFORM set_config('t313.cb', cb::text, false);
  PERFORM set_config('t313.ea', ea::text, false);
  PERFORM set_config('t313.eb', eb::text, false);
  PERFORM set_config('t313.ids', ids::text, false);
END $$;

-- Fresh rows per probe (inserted as owner, removed by the probe's rollback).
CREATE FUNCTION pg_temp.seed(prog text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.application_responses (program_id, user_id, applicant_email)
  VALUES (current_setting('t313.' || prog)::uuid, (current_setting('t313.ids')::jsonb->>'appl')::uuid, 'appl@t313.test')
  RETURNING id INTO rid;
  RETURN rid;
END $$;

-- Run one statement as a person and report rows affected or SQLSTATE.
-- Everything (role, claims, data changes) is rolled back by the RAISE.
CREATE FUNCTION pg_temp.try(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; res text;
BEGIN
  BEGIN
    IF who = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      EXECUTE 'SET LOCAL ROLE anon';
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('t313.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0313', MESSAGE = 'rows=' || n;
  EXCEPTION WHEN SQLSTATE 'P0313' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  RETURN res;
END $$;

CREATE FUNCTION pg_temp.fn(who text, expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', current_setting('t313.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT (' || expr || ')::text' INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0313', MESSAGE = coalesce(v, 'null');
  EXCEPTION WHEN SQLSTATE 'P0313' THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'err ' || SQLSTATE;
  END;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t313 (label, got, want) VALUES (label, got, want);
$$;

-- Delete one application in a program, by id (PostgREST's normal shape).
CREATE FUNCTION pg_temp.del_resp(who text, prog text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE rid uuid := pg_temp.seed(prog); r text;
BEGIN
  r := pg_temp.try(who, format('DELETE FROM public.application_responses WHERE id = %L', rid));
  DELETE FROM public.application_responses WHERE id = rid;
  RETURN r;
END $$;

-- Unfiltered delete: no WHERE, so SELECT policies are not consulted.
-- Reports how many of program B's rows the person removed.
CREATE FUNCTION pg_temp.del_resp_unfiltered_b(who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE ra uuid := pg_temp.seed('pa'); rb uuid := pg_temp.seed('pb'); res text;
BEGIN
  BEGIN
    IF who = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      EXECUTE 'SET LOCAL ROLE anon';
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('t313.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    DELETE FROM public.application_responses;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0313', MESSAGE =
      'B_deleted=' || (SELECT count(*) FROM (VALUES (rb)) v(id) WHERE NOT EXISTS (SELECT 1 FROM public.application_responses x WHERE x.id = v.id));
  EXCEPTION WHEN SQLSTATE 'P0313' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  DELETE FROM public.application_responses WHERE id IN (ra, rb);
  RETURN res;
END $$;

-- ── 1. 223 application DELETE: own program yes, other program no ──
SELECT pg_temp.expect('resp DELETE mA  on A', pg_temp.del_resp('mA',  'pa'), 'rows=1');
SELECT pg_temp.expect('resp DELETE mA  on B', pg_temp.del_resp('mA',  'pb'), 'rows=0');
SELECT pg_temp.expect('resp DELETE apA on A', pg_temp.del_resp('apA', 'pa'), 'rows=1');
SELECT pg_temp.expect('resp DELETE apA on B', pg_temp.del_resp('apA', 'pb'), 'rows=0');
SELECT pg_temp.expect('resp DELETE plA on A', pg_temp.del_resp('plA', 'pa'), 'rows=1');
SELECT pg_temp.expect('resp DELETE plA on B', pg_temp.del_resp('plA', 'pb'), 'rows=0');
SELECT pg_temp.expect('resp DELETE plT on A', pg_temp.del_resp('plT', 'pa'), 'rows=0');
SELECT pg_temp.expect('resp DELETE evE on A', pg_temp.del_resp('evE', 'pa'), 'rows=0');
SELECT pg_temp.expect('resp DELETE mG  on A', pg_temp.del_resp('mG',  'pa'), 'rows=1');
SELECT pg_temp.expect('resp DELETE mG  on B', pg_temp.del_resp('mG',  'pb'), 'rows=1');
SELECT pg_temp.expect('resp DELETE adm on B', pg_temp.del_resp('adm', 'pb'), 'rows=1');
SELECT pg_temp.expect('resp DELETE off on A', pg_temp.del_resp('off', 'pa'), 'rows=0');
SELECT pg_temp.expect('resp DELETE nobody on A', pg_temp.del_resp('nobody', 'pa'), 'rows=0');
SELECT pg_temp.expect('resp DELETE anon on A (denied)', pg_temp.del_resp('anon', 'pa'), 'err 42501');
-- The real exploit shape: an unfiltered DELETE skips SELECT policies.
SELECT pg_temp.expect('resp unfiltered DELETE mA  removes B', pg_temp.del_resp_unfiltered_b('mA'),  'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE apA removes B', pg_temp.del_resp_unfiltered_b('apA'), 'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE plA removes B', pg_temp.del_resp_unfiltered_b('plA'), 'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE plT removes B', pg_temp.del_resp_unfiltered_b('plT'), 'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE evE removes B', pg_temp.del_resp_unfiltered_b('evE'), 'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE off removes B', pg_temp.del_resp_unfiltered_b('off'), 'B_deleted=0');
SELECT pg_temp.expect('resp unfiltered DELETE mG  removes B', pg_temp.del_resp_unfiltered_b('mG'),  'B_deleted=1');

-- schools.manage on A, and the applicant (user_id = auth.uid()) on their own
-- row in B. The own-row SELECT policy makes the id visible, so a DELETE by
-- id has to be refused by the program-scoped DELETE policy.
CREATE FUNCTION pg_temp.del_own_resp_b(who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE rid uuid; r text;
BEGIN
  INSERT INTO public.application_responses (program_id, user_id, applicant_email)
  VALUES (
    current_setting('t313.pb')::uuid,
    (current_setting('t313.ids')::jsonb->>who)::uuid,
    who || '@t313.test'
  )
  RETURNING id INTO rid;
  r := pg_temp.try(who, format('DELETE FROM public.application_responses WHERE id = %L', rid));
  DELETE FROM public.application_responses WHERE id = rid;
  RETURN r;
END $$;
SELECT pg_temp.expect('resp DELETE mA own application in B', pg_temp.del_own_resp_b('mA'), 'rows=0');

-- ── 2. enrollments DELETE (unfiltered: counts rows removed of A's and B's one each) ──
CREATE FUNCTION pg_temp.del_enr(who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.try(who, 'DELETE FROM public.enrollments WHERE program_id IN ('
    || quote_literal(current_setting('t313.pa')) || ',' || quote_literal(current_setting('t313.pb')) || ')');
END $$;
CREATE FUNCTION pg_temp.del_enr_all(who text, prog text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE res text; keep uuid := current_setting('t313.e' || right(prog, 1))::uuid;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', current_setting('t313.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM public.enrollments;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0313', MESSAGE =
      'gone=' || (NOT EXISTS (SELECT 1 FROM public.enrollments WHERE id = keep))::text;
  EXCEPTION WHEN SQLSTATE 'P0313' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  RETURN res;
END $$;
SELECT pg_temp.expect('enr unfiltered DELETE mA  removes A', pg_temp.del_enr_all('mA',  'pa'), 'gone=true');
SELECT pg_temp.expect('enr unfiltered DELETE mA  removes B', pg_temp.del_enr_all('mA',  'pb'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE enA removes A', pg_temp.del_enr_all('enA', 'pa'), 'gone=true');
SELECT pg_temp.expect('enr unfiltered DELETE enA removes B', pg_temp.del_enr_all('enA', 'pb'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE plA removes B', pg_temp.del_enr_all('plA', 'pb'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE plT removes A', pg_temp.del_enr_all('plT', 'pa'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE evE removes A', pg_temp.del_enr_all('evE', 'pa'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE off removes A', pg_temp.del_enr_all('off', 'pa'), 'gone=false');
SELECT pg_temp.expect('enr unfiltered DELETE mG  removes B', pg_temp.del_enr_all('mG',  'pb'), 'gone=true');
SELECT pg_temp.expect('enr unfiltered DELETE adm removes B', pg_temp.del_enr_all('adm', 'pb'), 'gone=true');

-- ── 3. grades INSERT ──
CREATE FUNCTION pg_temp.ins_grade(who text, prog text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.try(who, format(
    'INSERT INTO public.grades (enrollment_id, course_id, letter_grade) VALUES (%L, %L, ''A'')',
    current_setting('t313.e' || right(prog, 1)), current_setting('t313.c' || right(prog, 1))));
END $$;
SELECT pg_temp.expect('grade INSERT mA  in A', pg_temp.ins_grade('mA',  'pa'), 'rows=1');
SELECT pg_temp.expect('grade INSERT mA  in B', pg_temp.ins_grade('mA',  'pb'), 'err 42501');
SELECT pg_temp.expect('grade INSERT plA in A', pg_temp.ins_grade('plA', 'pa'), 'rows=1');
SELECT pg_temp.expect('grade INSERT plA in B', pg_temp.ins_grade('plA', 'pb'), 'err 42501');
SELECT pg_temp.expect('grade INSERT plT in A', pg_temp.ins_grade('plT', 'pa'), 'err 42501');
SELECT pg_temp.expect('grade INSERT evE in A', pg_temp.ins_grade('evE', 'pa'), 'err 42501');
SELECT pg_temp.expect('grade INSERT mG  in B', pg_temp.ins_grade('mG',  'pb'), 'rows=1');
SELECT pg_temp.expect('grade INSERT adm in B', pg_temp.ins_grade('adm', 'pb'), 'rows=1');
SELECT pg_temp.expect('grade INSERT off in A', pg_temp.ins_grade('off', 'pa'), 'err 42501');
SELECT pg_temp.expect('grade INSERT anon in A', pg_temp.ins_grade('anon', 'pa'), 'err 42501');

-- ── 3b. grades UPDATE across programs ──
-- The grade sits on an enrollment whose user is the caller, so the own-row
-- SELECT policy reveals it and the UPDATE policy is what decides. A passes.
-- B fails USING and affects 0 rows (a WITH CHECK failure would be err 42501).
CREATE FUNCTION pg_temp.upd_grade(who text, prog text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE eid uuid; gid uuid; r text;
BEGIN
  INSERT INTO public.enrollments (user_id, program_id)
  VALUES (
    (current_setting('t313.ids')::jsonb->>who)::uuid,
    current_setting('t313.' || prog)::uuid
  )
  RETURNING id INTO eid;
  INSERT INTO public.grades (enrollment_id, course_id, letter_grade)
  VALUES (eid, current_setting('t313.c' || right(prog, 1))::uuid, 'A')
  RETURNING id INTO gid;
  r := pg_temp.try(who, format('UPDATE public.grades SET letter_grade = %L WHERE id = %L', 'P', gid));
  DELETE FROM public.enrollments WHERE id = eid;
  RETURN r;
END $$;

-- No WHERE. Grades on appl's enrollments (mA cannot see them) and on mA's
-- own enrollments. B's letters must stay A even for the row mA cannot see.
CREATE FUNCTION pg_temp.upd_grade_unfiltered(who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  own_a uuid; own_b uuid;
  res text;
BEGIN
  INSERT INTO public.grades (enrollment_id, course_id, letter_grade) VALUES
    (current_setting('t313.ea')::uuid, current_setting('t313.ca')::uuid, 'A'),
    (current_setting('t313.eb')::uuid, current_setting('t313.cb')::uuid, 'A');
  INSERT INTO public.enrollments (user_id, program_id)
  VALUES ((current_setting('t313.ids')::jsonb->>who)::uuid, current_setting('t313.pa')::uuid)
  RETURNING id INTO own_a;
  INSERT INTO public.enrollments (user_id, program_id)
  VALUES ((current_setting('t313.ids')::jsonb->>who)::uuid, current_setting('t313.pb')::uuid)
  RETURNING id INTO own_b;
  INSERT INTO public.grades (enrollment_id, course_id, letter_grade) VALUES
    (own_a, current_setting('t313.ca')::uuid, 'A'),
    (own_b, current_setting('t313.cb')::uuid, 'A');
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', current_setting('t313.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.grades SET letter_grade = 'P';
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0313', MESSAGE =
      'A_updated=' || (SELECT count(*) FROM public.grades g
                       JOIN public.enrollments e ON e.id = g.enrollment_id
                       WHERE e.program_id = current_setting('t313.pa')::uuid
                         AND g.letter_grade = 'P')
      || ',B_updated=' || (SELECT count(*) FROM public.grades g
                           JOIN public.enrollments e ON e.id = g.enrollment_id
                           WHERE e.program_id = current_setting('t313.pb')::uuid
                             AND g.letter_grade IS DISTINCT FROM 'A');
  EXCEPTION WHEN SQLSTATE 'P0313' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  DELETE FROM public.grades
   WHERE enrollment_id IN (current_setting('t313.ea')::uuid, current_setting('t313.eb')::uuid, own_a, own_b);
  DELETE FROM public.enrollments WHERE id IN (own_a, own_b);
  RETURN res;
END $$;
SELECT pg_temp.expect('grade UPDATE mA  on A', pg_temp.upd_grade('mA', 'pa'), 'rows=1');
SELECT pg_temp.expect('grade UPDATE mA  on B', pg_temp.upd_grade('mA', 'pb'), 'rows=0');
SELECT pg_temp.expect('grade unfiltered UPDATE mA leaves B', pg_temp.upd_grade_unfiltered('mA'), 'A_updated=2,B_updated=0');

-- ── 4. helper functions directly ──
SELECT pg_temp.expect('has_permission_for(manage,A) mA',  pg_temp.fn('mA',  format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pa'))), 'true');
SELECT pg_temp.expect('has_permission_for(manage,B) mA',  pg_temp.fn('mA',  format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pb'))), 'false');
SELECT pg_temp.expect('has_permission_for(manage,A) plT', pg_temp.fn('plT', format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pa'))), 'false');
SELECT pg_temp.expect('has_permission_for(manage,A) evE', pg_temp.fn('evE', format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pa'))), 'false');
SELECT pg_temp.expect('has_permission_for(manage,B) mG',  pg_temp.fn('mG',  format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pb'))), 'true');
SELECT pg_temp.expect('has_permission_for(manage,A) off', pg_temp.fn('off', format('public.has_permission_for(''schools.manage'', %L)', current_setting('t313.pa'))), 'false');
SELECT pg_temp.expect('has_permission(manage) off',       pg_temp.fn('off', 'public.has_permission(''schools.manage'')'), 'false');
SELECT pg_temp.expect('has_permission(manage) mG',        pg_temp.fn('mG',  'public.has_permission(''schools.manage'')'), 'true');
-- Unchanged by design (option b): has_permission still counts scoped grants.
SELECT pg_temp.expect('has_permission(manage) mA (unchanged)',        pg_temp.fn('mA',  'public.has_permission(''schools.manage'')'), 'true');
SELECT pg_temp.expect('has_permission(events.create) evE (unchanged)', pg_temp.fn('evE', 'public.has_permission(''events.create'')'), 'true');
SELECT pg_temp.expect('has_schools_access() off',  pg_temp.fn('off', 'public.has_schools_access()'), 'false');
SELECT pg_temp.expect('has_schools_access(A) off', pg_temp.fn('off', format('public.has_schools_access(%L)', current_setting('t313.pa'))), 'false');
SELECT pg_temp.expect('is_admin() adm',            pg_temp.fn('adm', 'public.is_admin()'), 'true');
SELECT pg_temp.expect('enrollment_program_id(ea)', pg_temp.fn('mA', format('public.enrollment_program_id(%L)', current_setting('t313.ea'))), current_setting('t313.pa'));
-- NULL and an unknown id both miss, so the helper returns NULL. Feeding
-- that to the grade policy denies a scoped holder: has_permission_for
-- compares scope_id, and NULL does not match. An unscoped holder still
-- gets true, because scope_type IS NULL matches without comparing the
-- target, and the grade policy allows them. An admin's
-- has_permission_for(..., NULL) is false (no schools.manage grant) but
-- is_admin() is true, so the grade policy allows them too.
SELECT pg_temp.expect('enrollment_program_id(NULL)',
  pg_temp.fn('mA', 'public.enrollment_program_id(NULL)'), 'null');
SELECT pg_temp.expect('enrollment_program_id(unknown)',
  pg_temp.fn('mA', format('public.enrollment_program_id(%L)', gen_random_uuid())), 'null');
SELECT pg_temp.expect('has_permission_for(manage,NULL) mA',
  pg_temp.fn('mA', 'public.has_permission_for(''schools.manage'', NULL)'), 'false');
SELECT pg_temp.expect('grade policy fed NULL program mA',
  pg_temp.fn('mA', 'public.is_admin() OR public.has_permission_for(''schools.manage'', public.enrollment_program_id(NULL))'),
  'false');
SELECT pg_temp.expect('grade policy fed unknown enrollment mA',
  pg_temp.fn('mA', format('public.is_admin() OR public.has_permission_for(''schools.manage'', public.enrollment_program_id(%L))', gen_random_uuid())),
  'false');
SELECT pg_temp.expect('anon cannot call enrollment_program_id',
  pg_temp.try('anon', format('SELECT public.enrollment_program_id(%L)', current_setting('t313.ea'))), 'err 42501');
SELECT pg_temp.expect('anon has_permission is false (EXECUTE kept)',
  pg_temp.try('anon', 'SELECT 1 WHERE public.has_permission(''schools.manage'')'), 'rows=0');

-- ── 5. definitions ──
SELECT pg_temp.expect('definer fns have search_path=""',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('has_permission', 'has_permission_for', 'enrollment_program_id')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']),
  'enrollment_program_id,has_permission,has_permission_for');

-- No second permissive DELETE (or ALL) policy on these tables. 313 replaces
-- the one schools DELETE on each; another would OR with it and re-open
-- program B, including the applicant's own row above.
SELECT pg_temp.expect('DELETE/ALL policies on application_responses and enrollments',
  (SELECT string_agg(tablename || '=' || n, ',' ORDER BY tablename)
   FROM (
     SELECT tablename, count(*)::text AS n
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('application_responses', 'enrollments')
       AND cmd IN ('DELETE', 'ALL')
     GROUP BY tablename
   ) s),
  'application_responses=1,enrollments=1');

-- ── Report ──
SELECT CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END AS result, label, got, want
FROM t313 ORDER BY n;
DO $$
DECLARE np int; nf int;
BEGIN
  SELECT count(*) FILTER (WHERE got IS NOT DISTINCT FROM want), count(*) FILTER (WHERE got IS DISTINCT FROM want)
  INTO np, nf FROM t313;
  RAISE NOTICE '313 test: % passed, % failed', np, nf;
  IF nf > 0 THEN RAISE EXCEPTION '313 test: % checks failed', nf; END IF;
END $$;
ROLLBACK;
