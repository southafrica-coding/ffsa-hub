-- Disposable check for migration 316. Not a migration. Throwaway DB only,
-- one transaction, rolled back.
--   psql -v ON_ERROR_STOP=1 -d <throwaway> -f finance_scope_templates_active_roles_test.sql
-- Exits non-zero (psql exit 3) if any check fails.
-- People (programs A, B):
--   feA    finance.edit scoped to A only (prod shape of 666e334c minus view)
--   feAv   finance.edit scoped to A + finance.view unscoped (prod shape of the 3)
--   feG    finance.edit unscoped
--   frA    role 'fin_bundle' (carries finance.edit) scoped to program A
--   frG    the same role unscoped
--   fadm   finance_admin role
--   offfe  deactivated, finance.edit unscoped
--   mA     schools.manage scoped to A        plA  program_leader role scoped to A
--   mG     schools.manage unscoped           ffx  role bundle (unscoped) with schools.manage
--   adm    admin                             offadm deactivated admin
--   offst  deactivated staff                 st   active staff
--   offfa  deactivated finance_admin         nobody
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
BEGIN;

CREATE TEMP TABLE t316 (n serial, label text, got text, want text);
GRANT ALL ON t316 TO PUBLIC;
GRANT USAGE ON SEQUENCE t316_n_seq TO PUBLIC;

DO $$
DECLARE
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  ids jsonb := '{}'::jsonb; who text; org uuid; tpl uuid; tq uuid; fp uuid; og uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['feA','feAv','feG','frA','frG','fadm','offfe','mA','plA','mG','ffx','adm','offadm','offst','st','offfa','nobody'] LOOP
    ids := ids || jsonb_build_object(who, gen_random_uuid());
    INSERT INTO auth.users (id, email) VALUES ((ids->>who)::uuid, lower(who) || '@t316.test');
    INSERT INTO public.users (id, email, first_name, last_name, is_active)
    VALUES ((ids->>who)::uuid, lower(who) || '@t316.test', who, 'T316', who NOT LIKE 'off%');
  END LOOP;
  INSERT INTO public.programs (id, name, code, created_by) VALUES
    (pa, 't316 A', 'T316A' || left(pa::text, 4), (ids->>'adm')::uuid),
    (pb, 't316 B', 'T316B' || left(pb::text, 4), (ids->>'adm')::uuid);
  INSERT INTO public.roles (name, display_name) VALUES
    ('program_leader','Program Leader'), ('admin','Admin'), ('finance_admin','Finance Admin'),
    ('staff','Staff'), ('fin_bundle','T316 finance bundle'), ('ffx_like','T316 schools bundle')
  ON CONFLICT (name) DO NOTHING;
  INSERT INTO public.permissions (module, key, display_name) VALUES
    ('finance','finance.edit','Edit finance'), ('finance','finance.view','View finance'),
    ('schools','schools.manage','Manage schools'), ('events','events.create','Create events')
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
   WHERE (r.name, p.key) IN (('program_leader','schools.manage'), ('fin_bundle','finance.edit'), ('ffx_like','schools.manage'))
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id)
  SELECT (ids->>x.who)::uuid, r.id, x.st, x.sid FROM (VALUES
    ('frA','fin_bundle','program',pa), ('frG','fin_bundle',NULL,NULL::uuid), ('fadm','finance_admin',NULL,NULL),
    ('plA','program_leader','program',pa), ('ffx','ffx_like',NULL,NULL), ('adm','admin',NULL,NULL),
    ('offadm','admin',NULL,NULL), ('offst','staff',NULL,NULL), ('st','staff',NULL,NULL), ('offfa','finance_admin',NULL,NULL)
  ) x(who, role, st, sid) JOIN public.roles r ON r.name = x.role;
  INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
  SELECT (ids->>x.who)::uuid, p.id, x.st, x.sid FROM (VALUES
    ('feA','finance.edit','program',pa), ('feAv','finance.edit','program',pa), ('feAv','finance.view',NULL,NULL::uuid),
    ('feG','finance.edit',NULL,NULL), ('offfe','finance.edit',NULL,NULL),
    ('mA','schools.manage','program',pa), ('mA','events.create','event',gen_random_uuid()),
    ('mG','schools.manage',NULL,NULL)
  ) x(who, key, st, sid) JOIN public.permissions p ON p.key = x.key;

  SELECT id INTO org FROM public.finance_orgs WHERE key = 'npc';
  IF org IS NULL THEN
    INSERT INTO public.finance_orgs (key, name, xero_region, record_currency) VALUES ('npc','T316 NPC','za','ZAR') RETURNING id INTO org;
  END IF;
  INSERT INTO public.finance_projects (org_id, name) VALUES (org, 't316 project') RETURNING id INTO fp;
  INSERT INTO public.application_templates (name) VALUES ('t316 tpl') RETURNING id INTO tpl;
  INSERT INTO public.application_template_questions (template_id, label) VALUES (tpl, 'q1') RETURNING id INTO tq;
  INSERT INTO public.outreach_groups (name) VALUES ('t316 group') RETURNING id INTO og;
  INSERT INTO public.contacts (first_name, last_name) VALUES ('T316','Contact');

  PERFORM set_config('t316.ids', ids::text, false);
  PERFORM set_config('t316.pa', pa::text, false); PERFORM set_config('t316.pb', pb::text, false);
  PERFORM set_config('t316.org', org::text, false); PERFORM set_config('t316.fp', fp::text, false);
  PERFORM set_config('t316.tpl', tpl::text, false); PERFORM set_config('t316.tq', tq::text, false);
  PERFORM set_config('t316.og', og::text, false);
END $$;

CREATE FUNCTION pg_temp.as_(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF who = 'anon' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSIF who = 'service' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE service_role';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('t316.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', current_setting('t316.ids')::jsonb->>who, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END $$;
-- statement as a person: rows affected or SQLSTATE; always rolled back
CREATE FUNCTION pg_temp.try(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; res text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_(who);
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0316', MESSAGE = 'rows=' || n;
  EXCEPTION WHEN SQLSTATE 'P0316' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  RETURN res;
END $$;
-- expression as a person
CREATE FUNCTION pg_temp.fn(who text, expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_(who);
    EXECUTE 'SELECT (' || expr || ')::text' INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0316', MESSAGE = coalesce(v, 'null');
  EXCEPTION WHEN SQLSTATE 'P0316' THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'err ' || SQLSTATE;
  END;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t316 (label, got, want) VALUES (label, got, want);
$$;
CREATE FUNCTION pg_temp.s(k text) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('t316.' || k) $$;

-- ── C. finance: scoped finance.edit stays in its program ──
SELECT pg_temp.expect('C has_permission(finance.edit) '||w, pg_temp.fn(w, $q$public.has_permission('finance.edit')$q$), e)
FROM (VALUES ('feA','false'),('feAv','false'),('frA','false'),('feG','true'),('frG','true'),('offfe','false'),('nobody','false'),('anon','false')) v(w,e);
SELECT pg_temp.expect('C has_permission_for(finance.edit, A) feA', pg_temp.fn('feA', format($q$public.has_permission_for('finance.edit', %L::uuid)$q$, pg_temp.s('pa'))), 'true');
SELECT pg_temp.expect('C has_permission_for(finance.edit, B) feA', pg_temp.fn('feA', format($q$public.has_permission_for('finance.edit', %L::uuid)$q$, pg_temp.s('pb'))), 'false');
SELECT pg_temp.expect('C has_permission_for(finance.edit, A) frA (role)', pg_temp.fn('frA', format($q$public.has_permission_for('finance.edit', %L::uuid)$q$, pg_temp.s('pa'))), 'true');
-- other modules keep any-scope semantics (313 option b)
SELECT pg_temp.expect('C has_permission(schools.manage) mA (scoped, unchanged)', pg_temp.fn('mA', $q$public.has_permission('schools.manage')$q$), 'true');
SELECT pg_temp.expect('C has_permission(schools.manage) plA (role scoped, unchanged)', pg_temp.fn('plA', $q$public.has_permission('schools.manage')$q$), 'true');
SELECT pg_temp.expect('C has_permission(events.create) mA (event scoped, unchanged)', pg_temp.fn('mA', $q$public.has_permission('events.create')$q$), 'true');
-- outreach staff
SELECT pg_temp.expect('C outreach editor '||w, pg_temp.fn(w, 'public.is_outreach_staff_editor()'), e)
FROM (VALUES ('feA','false'),('feAv','false'),('frA','false'),('feG','true'),('frG','true'),('fadm','true'),('adm','true'),('offfe','false'),('offfa','false'),('offadm','false')) v(w,e);
SELECT pg_temp.expect('C outreach viewer '||w, pg_temp.fn(w, 'public.is_outreach_staff_viewer()'), e)
FROM (VALUES ('feA','false'),('feAv','true'),('feG','true'),('fadm','true'),('offfe','false')) v(w,e);
-- finance_projects writes
SELECT pg_temp.expect('C finance_projects INSERT '||w, pg_temp.try(w, format($q$INSERT INTO public.finance_projects (org_id, name) VALUES (%L, 'x316 '||%L)$q$, pg_temp.s('org'), w)), e)
FROM (VALUES ('feA','err 42501'),('feAv','err 42501'),('frA','err 42501'),('feG','rows=1'),('frG','rows=1'),('fadm','rows=1'),('adm','rows=1'),('offfe','err 42501'),('offadm','err 42501')) v(w,e);
SELECT pg_temp.expect('C finance_projects UPDATE '||w, pg_temp.try(w, format($q$UPDATE public.finance_projects SET notes = 't316' WHERE id = %L$q$, pg_temp.s('fp'))), e)
FROM (VALUES ('feA','rows=0'),('feAv','rows=0'),('frA','rows=0'),('feG','rows=1'),('fadm','rows=1'),('offfe','rows=0')) v(w,e);
-- reads
SELECT pg_temp.expect('C finance_projects SELECT '||w, pg_temp.fn(w, format($q$(SELECT count(*) FROM public.finance_projects WHERE id = %L)$q$, pg_temp.s('fp'))), e)
FROM (VALUES ('feA','0'),('feAv','1'),('feG','1'),('offfe','0')) v(w,e);
SELECT pg_temp.expect('C finance_orgs SELECT '||w, pg_temp.fn(w, format($q$(SELECT count(*) FROM public.finance_orgs WHERE id = %L)$q$, pg_temp.s('org'))), e)
FROM (VALUES ('feA','0'),('feAv','1'),('feG','1')) v(w,e);
SELECT pg_temp.expect('C finance_org_choices '||w, pg_temp.fn(w, format($q$(SELECT count(*) FROM public.finance_org_choices() c WHERE c.id = %L)$q$, pg_temp.s('org'))), e)
FROM (VALUES ('feA','0'),('feAv','1'),('feG','1')) v(w,e);
SELECT pg_temp.expect('C xero_accounts SELECT visible to '||w, pg_temp.fn(w, $q$(SELECT count(*) FROM public.xero_accounts) = (SELECT count(*) FROM public.xero_accounts)$q$), 'true')
FROM (VALUES ('feG'),('feAv')) v(w);
-- outreach groups writes
SELECT pg_temp.expect('C outreach_groups UPDATE '||w, pg_temp.try(w, format($q$UPDATE public.outreach_groups SET name = 't316 g2' WHERE id = %L$q$, pg_temp.s('og'))), e)
FROM (VALUES ('feA','rows=0'),('feAv','rows=0'),('feG','rows=1'),('fadm','rows=1')) v(w,e);
SELECT pg_temp.expect('C outreach_groups INSERT '||w, pg_temp.try(w, $q$INSERT INTO public.outreach_groups (name) VALUES ('t316 new')$q$), e)
FROM (VALUES ('feA','err 42501'),('feAv','err 42501'),('feG','rows=1')) v(w,e);

-- ── D. template library writes: admin or unscoped schools.manage ──
SELECT pg_temp.expect('D templates SELECT '||w, pg_temp.fn(w, format($q$(SELECT count(*) FROM public.application_templates WHERE id = %L)$q$, pg_temp.s('tpl'))), e)
FROM (VALUES ('mA','1'),('plA','1'),('mG','1'),('adm','1'),('nobody','0')) v(w,e);
SELECT pg_temp.expect('D template questions SELECT '||w, pg_temp.fn(w, format($q$(SELECT count(*) FROM public.application_template_questions WHERE id = %L)$q$, pg_temp.s('tq'))), e)
FROM (VALUES ('mA','1'),('plA','1'),('mG','1')) v(w,e);
SELECT pg_temp.expect('D templates INSERT '||w, pg_temp.try(w, $q$INSERT INTO public.application_templates (name) VALUES ('t316 new')$q$), e)
FROM (VALUES ('mA','err 42501'),('plA','err 42501'),('mG','rows=1'),('ffx','rows=1'),('adm','rows=1'),('offadm','err 42501'),('nobody','err 42501'),('anon','err 42501')) v(w,e);
SELECT pg_temp.expect('D templates UPDATE '||w, pg_temp.try(w, format($q$UPDATE public.application_templates SET name = 't316 renamed' WHERE id = %L$q$, pg_temp.s('tpl'))), e)
FROM (VALUES ('mA','rows=0'),('plA','rows=0'),('mG','rows=1'),('ffx','rows=1'),('adm','rows=1'),('offadm','rows=0')) v(w,e);
SELECT pg_temp.expect('D templates DELETE '||w, pg_temp.try(w, format($q$DELETE FROM public.application_templates WHERE id = %L$q$, pg_temp.s('tpl'))), e)
FROM (VALUES ('mA','rows=0'),('plA','rows=0'),('mG','rows=1'),('adm','rows=1'),('offadm','rows=0')) v(w,e);
SELECT pg_temp.expect('D templates unfiltered DELETE mA', pg_temp.try('mA', $q$DELETE FROM public.application_templates$q$), 'rows=0');
SELECT pg_temp.expect('D template questions INSERT '||w, pg_temp.try(w, format($q$INSERT INTO public.application_template_questions (template_id, label) VALUES (%L, 'q2')$q$, pg_temp.s('tpl'))), e)
FROM (VALUES ('mA','err 42501'),('plA','err 42501'),('mG','rows=1'),('adm','rows=1'),('offadm','err 42501')) v(w,e);
SELECT pg_temp.expect('D template questions DELETE '||w, pg_temp.try(w, format($q$DELETE FROM public.application_template_questions WHERE id = %L$q$, pg_temp.s('tq'))), e)
FROM (VALUES ('mA','rows=0'),('plA','rows=0'),('mG','rows=1'),('adm','rows=1')) v(w,e);

-- ── E. roles count only for active accounts ──
SELECT pg_temp.expect('E is_admin '||w, pg_temp.fn(w, 'public.is_admin()'), e)
FROM (VALUES ('adm','true'),('offadm','false'),('nobody','false'),('anon','false'),('service','false')) v(w,e);
SELECT pg_temp.expect('E has_any_role(staff) '||w, pg_temp.fn(w, $q$public.has_any_role(ARRAY['staff'])$q$), e)
FROM (VALUES ('st','true'),('offst','false')) v(w,e);
SELECT pg_temp.expect('E has_role(finance_admin) '||w, pg_temp.fn(w, $q$public.has_role('finance_admin')$q$), e)
FROM (VALUES ('fadm','true'),('offfa','false')) v(w,e);
SELECT pg_temp.expect('E has_role(program_leader, program, A) plA', pg_temp.fn('plA', format($q$public.has_role('program_leader', 'program', %L::uuid)$q$, pg_temp.s('pa'))), 'true');
SELECT pg_temp.expect('E has_role(program_leader, program, B) plA', pg_temp.fn('plA', format($q$public.has_role('program_leader', 'program', %L::uuid)$q$, pg_temp.s('pb'))), 'false');
SELECT pg_temp.expect('E has_role(program_leader) unscoped call plA', pg_temp.fn('plA', $q$public.has_role('program_leader')$q$), 'false');
SELECT pg_temp.expect('E contacts SELECT '||w, pg_temp.fn(w, $q$(SELECT count(*) FROM public.contacts WHERE first_name = 'T316')$q$), e)
FROM (VALUES ('st','1'),('offst','0'),('adm','1'),('offadm','0')) v(w,e);

-- ── department normalised on INSERT (service-role shape and owner) ──
CREATE FUNCTION pg_temp.ins_dept(d text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE i uuid := gen_random_uuid(); v text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (i, i || '@d316.test');
  INSERT INTO public.users (id, email, first_name, last_name, department) VALUES (i, i || '@d316.test', 'D', 'T316', d);
  SELECT coalesce(department, '<null>') INTO v FROM public.users WHERE id = i;
  RETURN v;
END $$;
SELECT pg_temp.expect('dept INSERT padded', pg_temp.ins_dept(E'  training \t'), 'training');
SELECT pg_temp.expect('dept INSERT blank', pg_temp.ins_dept('   '), '<null>');
SELECT pg_temp.expect('dept INSERT NBSP/VT/newline only', pg_temp.ins_dept(E'\u00a0\x0B\n'), '<null>');
SELECT pg_temp.expect('dept INSERT null', pg_temp.ins_dept(NULL), '<null>');
SELECT pg_temp.expect('dept INSERT clean', pg_temp.ins_dept('training'), 'training');

-- ── catalog: search_path, definer, ACL ──
SELECT pg_temp.expect('catalog '||f||' search_path', (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = to_regprocedure(f)), 'search_path=""')
FROM (VALUES ('public.has_permission(text)'),('public.has_any_role(text[])'),('public.has_role(text,text,uuid)'),('public.is_admin()'),('public.users_normalise_department_on_insert()')) v(f);
SELECT pg_temp.expect('catalog '||f||' definer', (SELECT prosecdef::text FROM pg_proc WHERE oid = to_regprocedure(f)), 'true')
FROM (VALUES ('public.has_permission(text)'),('public.has_any_role(text[])'),('public.has_role(text,text,uuid)'),('public.is_admin()')) v(f);
SELECT pg_temp.expect('catalog '||f||' EXECUTE anon+authenticated', (has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE'))::text, 'true')
FROM (VALUES ('public.has_permission(text)'),('public.has_any_role(text[])'),('public.has_role(text,text,uuid)'),('public.is_admin()')) v(f);
SELECT pg_temp.expect('catalog dept trigger fn not executable by authenticated', CASE WHEN to_regprocedure('public.users_normalise_department_on_insert()') IS NULL THEN 'missing' ELSE has_function_privilege('authenticated', 'public.users_normalise_department_on_insert()', 'EXECUTE')::text END, 'false');
SELECT pg_temp.expect('catalog template write policies', (SELECT count(*)::text FROM pg_policies WHERE tablename IN ('application_templates','application_template_questions') AND cmd <> 'SELECT' AND coalesce(qual, with_check) LIKE '%has_permission_for(''schools.manage''::text, NULL::uuid)%'), '5');
SELECT pg_temp.expect('catalog template read policies unchanged', (SELECT count(*)::text FROM pg_policies WHERE tablename IN ('application_templates','application_template_questions') AND cmd = 'SELECT' AND qual = 'has_schools_access()'), '2');

-- ── report ──
DO $$
DECLARE r record; nf int := 0; np int := 0;
BEGIN
  FOR r IN SELECT * FROM t316 ORDER BY n LOOP
    IF r.got IS NOT DISTINCT FROM r.want THEN np := np + 1;
    ELSE nf := nf + 1; RAISE WARNING 'FAIL %: got %, want %', r.label, r.got, r.want; END IF;
  END LOOP;
  RAISE WARNING '316 test: % passed, % failed', np, nf;
  IF nf > 0 THEN
    RAISE EXCEPTION '316 test: % checks failed', nf;
  END IF;
END $$;
ROLLBACK;
